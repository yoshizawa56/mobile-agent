import { HTTPException } from "hono/http-exception";
import { upgradeWebSocket, websocket, type BunWebSocketData, type BunWebSocketHandler } from "hono/bun";
import { cors } from "hono/cors";
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import {
  muximodCapabilitiesSchema,
  muximodHealthSchema,
  authChallengeRequestSchema,
  authChallengeResponseSchema,
  authInfoSchema,
  authSessionRequestSchema,
  authSessionResponseSchema,
  createPaneRequestSchema,
  createSessionRequestSchema,
  pairingClaimRequestSchema,
  pairingClaimResponseSchema,
  pairingStatusSchema,
  paneResponseSchema,
  registerWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceBrowseResponseSchema,
  workspaceListResponseSchema,
  workspaceResponseSchema,
  wsTicketRequestSchema,
  wsTicketResponseSchema,
  type CreatePaneRequest,
} from "@muximo/protocol";
import { HonoSocketAdapter } from "./socket.js";
import type {
  MuximodAuthContext,
  MuximodHttpDependencies,
  MuximodHttpStatus,
  MuximodHookEvent,
} from "./types.js";
import { validate } from "./validation.js";

export class MuximodHttpError extends Error {
  public constructor(
    public readonly status: MuximodHttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MuximodHttpError";
  }
}

type AppEnv = { Variables: { auth: MuximodAuthContext; websocketContext: MuximodAuthContext } };

const pairingParamsSchema = z.object({ pairingId: z.string().trim().min(1).max(256) }).strict();
const workspaceParamsSchema = z.object({ workspaceId: z.string().trim().min(1).max(256) }).strict();
const workspaceQuerySchema = z.object({ path: z.string().trim().max(4_096).optional() }).strict();
const paneQuerySchema = z.object({ session: z.string().trim().min(1).max(64).optional() }).strict();
const hookFormSchema = z.object({
  event: z.enum(["client-attached", "client-active", "client-resized", "client-focus-in", "client-detached"]),
  client: z.string().trim().min(1).max(256),
}).strict();

/**
 * Creates the Bun/Hono application. This function has no process, database,
 * tmux, PTY, or filesystem side effects; all host behavior arrives through
 * the narrow dependency object.
 */
export function createMuximodApp(deps: MuximodHttpDependencies) {
  const origin = (): string => deps.corsOrigin;

  const authenticateWebSocket = (endpoint: "terminal" | "events") => async (c: Context<AppEnv>, next: Next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "upgrade_required", message: "WebSocket upgrade is required" }, 426);
    }
    const context = deps.auth.consumeWebSocketTicket(c.req.query("ticket"), endpoint);
    if (!context) {
      return c.json({ error: "unauthorized", message: "WebSocket authentication is required" }, 401);
    }
    c.set("websocketContext", context);
    await next();
  };

  const websocketHandler = (endpoint: "terminal" | "events") => upgradeWebSocket((c) => {
    const context = c.get("websocketContext");
    let socket: HonoSocketAdapter | undefined;

    return {
      onOpen(_event: Event, ws: { readyState: number; send(data: string | ArrayBuffer | ArrayBufferView): void; close(code?: number, reason?: string): void }) {
        const connection = endpoint === "terminal" ? deps.onTerminalConnection : deps.onEventsConnection;
        if (!connection) {
          ws.close(1011, "WebSocket endpoint is unavailable");
          return;
        }
        socket = new HonoSocketAdapter(ws);
        connection(socket, context);
      },
      onMessage(event: MessageEvent) {
        socket?.receive(event.data);
      },
      onClose() {
        socket?.receiveClose();
      },
      onError(event: Event) {
        socket?.receiveError(event);
      },
    };
  });

  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const startedAt = Date.now();
      const path = new URL(c.req.url).pathname;
      deps.logger?.debug("http.request_started", { method: c.req.method, path });
      await next();
      deps.logger?.debug("http.request_finished", { method: c.req.method, path, statusCode: c.res.status, durationMs: Date.now() - startedAt });
    })
    .onError((error, c) => {
      if (error instanceof HTTPException) {
        const code = error.status === 400 ? "invalid_request" : "http_error";
        return c.json({ error: code, message: error.message }, error.status);
      }
      const mapped = mapError(error);
      deps.logger?.error("http.request_failed", { code: mapped.code, status: mapped.status, message: mapped.message });
      return c.json(errorBody(mapped), mapped.status);
    })
    .notFound((c) => c.json({ error: "not_found", message: "Route not found" }, 404))
    .use("/auth/v1/*", cors({
      origin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
    }))
    .use("/api/*", cors({
      origin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
    }))
    .get("/health", (c) => {
      if (deps.isReady && !deps.isReady()) throw new MuximodHttpError(503, "muximod_unavailable", "muximod is still starting");
      return c.json(muximodHealthSchema.parse({ ok: true, service: "muximod", protocolVersion: 1 }));
    })
    .get("/auth/v1/info", (c) => c.json(authInfoSchema.parse({
      protocolVersion: 1,
      serverId: deps.auth.serverId,
      serverTime: new Date().toISOString(),
    })))
    .post("/auth/v1/pairings/:pairingId/claim", validate("param", pairingParamsSchema), validate("json", pairingClaimRequestSchema), (c) => {
      const response = deps.auth.claimPairing(
        c.req.param("pairingId"),
        c.req.valid("json") as z.infer<typeof pairingClaimRequestSchema>,
      );
      return c.json(pairingClaimResponseSchema.parse(response), 201);
    })
    .get("/auth/v1/pairings/:pairingId", validate("param", pairingParamsSchema), (c) => {
      const authorization = c.req.header("authorization");
      const claimToken = authorization?.startsWith("Pairing ") ? authorization.slice("Pairing ".length).trim() : undefined;
      if (!claimToken) throw new MuximodHttpError(401, "claim_token_required", "Pairing authorization is required");
      return c.json(pairingStatusSchema.parse(deps.auth.pairingStatus(c.req.param("pairingId"), claimToken)));
    })
    .post("/auth/v1/challenges", validate("json", authChallengeRequestSchema), (c) => c.json(
      authChallengeResponseSchema.parse(deps.auth.createChallenge((c.req.valid("json") as z.infer<typeof authChallengeRequestSchema>).deviceId)),
      201,
    ))
    .post("/auth/v1/sessions", validate("json", authSessionRequestSchema), (c) => c.json(
      authSessionResponseSchema.parse(deps.auth.createSession(c.req.valid("json") as z.infer<typeof authSessionRequestSchema>)),
      201,
    ))
    .post("/auth/v1/ws-tickets", validate("json", wsTicketRequestSchema), (c) => {
      const context = requireBearer(c.req.header("authorization"), deps);
      const input = c.req.valid("json") as z.infer<typeof wsTicketRequestSchema>;
      return c.json(wsTicketResponseSchema.parse(deps.auth.issueWebSocketTicket(context, input.endpoint)), 201);
    })
    .use("/api/*", async (c, next) => {
      c.set("auth", requireBearer(c.req.header("authorization"), deps));
      await next();
    })
    .get("/api/capabilities", (c) => c.json(muximodCapabilitiesSchema.parse({
      protocolVersion: 1,
      features: {
        tmuxSessions: true,
        terminalWebSocket: true,
        paneState: true,
        resourceInvalidationEvents: true,
      },
    })))
    .get("/api/workspaces", async (c) => c.json(workspaceListResponseSchema.parse({
    workspaces: await deps.application.workspaces.list(),
    })))
    .get("/api/workspace-directories", validate("query", workspaceQuerySchema), async (c) => {
      const query = c.req.valid("query") as z.infer<typeof workspaceQuerySchema>;
      return c.json(workspaceBrowseResponseSchema.parse({ directories: await deps.application.workspaces.browse(query.path) }));
    })
    .post("/api/workspaces", validate("json", registerWorkspaceRequestSchema), async (c) => {
      const input = c.req.valid("json") as z.infer<typeof registerWorkspaceRequestSchema>;
      return c.json(workspaceResponseSchema.parse({ workspace: await deps.application.workspaces.register(input) }), 201);
    })
    .patch("/api/workspaces/:workspaceId", validate("param", workspaceParamsSchema), validate("json", updateWorkspaceRequestSchema), async (c) => {
      const input = c.req.valid("json") as z.infer<typeof updateWorkspaceRequestSchema>;
      const workspace = await deps.application.workspaces.update(c.req.param("workspaceId"), input);
      return c.json(workspaceResponseSchema.parse({ workspace }), 200);
    })
    .delete("/api/workspaces/:workspaceId", validate("param", workspaceParamsSchema), async (c) => {
      await deps.application.workspaces.delete(c.req.param("workspaceId"));
      return c.body(null, 204);
    })
    .get("/api/terminals", async (c) => c.json({ terminals: [await deps.application.terminal.get()] }))
    .get("/api/sessions", async (c) => c.json({ sessions: await deps.application.sessions.list() }))
    .post("/api/sessions", validate("json", createSessionRequestSchema), async (c) => {
      const input = c.req.valid("json") as z.infer<typeof createSessionRequestSchema>;
      const workspace = input.workspaceId ? await deps.application.workspaces.resolveDirectory(input.workspaceId) : undefined;
      const session = await deps.application.sessions.create({
        name: input.name,
        initialCwd: workspace?.rootPath ?? input.cwd!,
      });
      return c.json({ session }, 201);
    })
    .get("/api/panes", validate("query", paneQuerySchema), async (c) => {
      const query = c.req.valid("query") as z.infer<typeof paneQuerySchema>;
      return c.json({ panes: await deps.application.panes.list(query.session) });
    })
    .post("/api/panes", validate("json", createPaneRequestSchema), async (c) => {
      const input = c.req.valid("json") as CreatePaneRequest;
      const workspace = input.workspaceId
        ? await deps.application.workspaces.resolveSelection({ workspaceId: input.workspaceId, mode: input.useWorktree ? "worktree" : "workspace" })
        : undefined;
      return c.json(paneResponseSchema.parse({
        pane: await deps.application.panes.create(input, workspace),
      }), 201);
    })
    .post("/internal/tmux-hook",
      (c, next) => {
        if (c.req.header("x-muximod-hook-token") !== deps.hookToken) throw new MuximodHttpError(401, "unauthorized", "Invalid tmux hook token");
        return next();
      },
      validate("form", hookFormSchema),
      (c) => {
        const form = c.req.valid("form") as z.infer<typeof hookFormSchema>;
        deps.application.hooks.handleTmux(form.event as MuximodHookEvent, form.client);
        return c.body(null, 204);
      })
    .use("/terminal", authenticateWebSocket("terminal"))
    .use("/events", authenticateWebSocket("events"))
    .get("/terminal", websocketHandler("terminal"))
    .get("/events", websocketHandler("events"));
}

export type MuximodApp = ReturnType<typeof createMuximodApp>;
export type { MuximodAuthContext, MuximodHttpDependencies, MuximodHttpStatus, MuximodHookEvent } from "./types.js";
export { muximodSocketReadyState, HonoSocketAdapter } from "./socket.js";
export type { MuximodSocket, MuximodSocketData } from "./socket.js";
export const muximodWebsocket: BunWebSocketHandler<BunWebSocketData> & { idleTimeout: number } = { ...websocket, idleTimeout: 0 };

function requireBearer(header: string | undefined, deps: MuximodHttpDependencies): MuximodAuthContext {
  if (!header?.startsWith("Bearer ")) throw new MuximodHttpError(401, "unauthorized", "Bearer authentication is required");
  const token = header.slice("Bearer ".length).trim();
  const context = deps.auth.authenticateAccessToken(token || undefined);
  if (!context) throw new MuximodHttpError(401, "unauthorized", "Bearer authentication is required");
  return context;
}

function mapError(error: unknown): MuximodHttpError {
  if (error instanceof MuximodHttpError) return error;
  if (error instanceof z.ZodError) return new MuximodHttpError(400, "invalid_request", "Request validation failed");
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    const status = errorStatus(error.code, error.status);
    const details = isRecord(error.details) ? error.details : undefined;
    return new MuximodHttpError(status, error.code, error.message, details);
  }
  return new MuximodHttpError(503, "muximod_unavailable", "muximod could not complete the request");
}

function errorStatus(code: string, status: unknown): MuximodHttpStatus {
  if (isMuximodHttpStatus(status)) return status;
  if (code === "pairing_not_found") return 404;
  if (code === "pairing_expired" || code === "claim_token_expired") return 410;
  if (code === "pairing_unavailable" || code === "pairing_not_awaiting_approval" || code === "pairing_not_rejectable" || code === "session_exists") return 409;
  if (code === "workspace_not_found") return 404;
  if (code === "workspace_already_registered" || code === "workspace_name_ambiguous") return 409;
  if (code === "claim_token_invalid" || code === "claim_signature_invalid" || code === "session_signature_invalid" || code === "challenge_invalid" || code === "device_inactive") return 401;
  if (code === "challenge_rate_limited") return 429;
  if (code === "session_not_visible" || code === "pane_not_visible" || code === "tmux_unavailable") return 503;
  return 400;
}

function errorBody(error: MuximodHttpError): { error: string; message: string; details?: Record<string, unknown> } {
  return { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
}

function isMuximodHttpStatus(value: unknown): value is MuximodHttpStatus {
  return value === 400 || value === 401 || value === 403 || value === 404 || value === 409 || value === 410 || value === 426 || value === 429 || value === 500 || value === 503;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
