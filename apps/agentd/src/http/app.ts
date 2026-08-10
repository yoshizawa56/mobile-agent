import { cors } from "hono/cors";
import { Hono } from "hono";
import type { CreatePaneRequest, PaneSummary, TmuxSession, TerminalEndpoint } from "@mobile-agent/protocol";
import { agentdCapabilitiesSchema, agentdHealthSchema, createPaneRequestSchema, createSessionRequestSchema, paneResponseSchema } from "@mobile-agent/protocol";

export type AgentdHookEvent =
  | "client-attached"
  | "client-active"
  | "client-resized"
  | "client-focus-in"
  | "client-detached";

export type AgentdHttpDependencies = {
  corsOrigin: string;
  hookToken: string;
  getTerminal: () => Promise<TerminalEndpoint>;
  listSessions: () => Promise<TmuxSession[]>;
  createSession: (input: { name: string; cwd: string }) => Promise<TmuxSession>;
  listPanes: (sessionName?: string) => Promise<PaneSummary[]>;
  createPane: (input: CreatePaneRequest) => Promise<PaneSummary>;
  handleTmuxHook: (event: AgentdHookEvent, client: string) => void;
};

export class AgentdHttpError extends Error {
  public constructor(
    public readonly status: 400 | 404 | 409 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentdHttpError";
  }
}

/**
 * Builds the HTTP application without constructing tmux, SQLite, sockets, or
 * other process-level resources. The returned type is exported as AgentdApp
 * so TypeScript clients can use Hono RPC without importing runtime code.
 */
export function createAgentdApp(deps: AgentdHttpDependencies) {
  return new Hono()
    .use(
      "/api/*",
      cors({
        origin: deps.corsOrigin,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["content-type", "authorization"],
      }),
    )
    .get("/health", (c) => {
      const response = {
        ok: true as const,
        service: "agentd" as const,
        protocolVersion: 1,
      };
      return c.json(agentdHealthSchema.parse(response));
    })
    .get("/api/capabilities", (c) => {
      const response = {
        protocolVersion: 1,
        features: {
          tmuxSessions: true,
          terminalWebSocket: true,
          paneState: true,
        },
      };
      return c.json(agentdCapabilitiesSchema.parse(response));
    })
    .get("/api/terminals", async (c) => {
      try {
        return c.json({ terminals: [await deps.getTerminal()] });
      } catch (error) {
        return c.json(toUnavailableError(error), 503);
      }
    })
    .get("/api/sessions", async (c) => {
      try {
        return c.json({ sessions: await deps.listSessions() });
      } catch (error) {
        return c.json(toUnavailableError(error), 503);
      }
    })
    .post("/api/sessions", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_request", message: "Request body must be valid JSON" }, 400);
      }

      const parsed = createSessionRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
      }

      try {
        return c.json({ session: await deps.createSession(parsed.data) }, 201);
      } catch (error) {
        if (error instanceof AgentdHttpError) {
          return c.json({ error: error.code, message: error.message }, error.status);
        }
        return c.json(toUnavailableError(error), 503);
      }
    })
    .get("/api/panes", async (c) => {
      try {
        const sessionName = c.req.query("session") || undefined;
        return c.json({ panes: await deps.listPanes(sessionName) });
      } catch (error) {
        return c.json(toUnavailableError(error), 503);
      }
    })
    .post("/api/panes", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_request", message: "Request body must be valid JSON" }, 400);
      }

      const parsed = createPaneRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
      }

      try {
        return c.json(paneResponseSchema.parse({ pane: await deps.createPane(parsed.data) }), 201);
      } catch (error) {
        if (error instanceof AgentdHttpError) {
          return c.json({ error: error.code, message: error.message }, error.status);
        }
        return c.json(toUnavailableError(error), 503);
      }
    })
    .post("/internal/tmux-hook", async (c) => {
      if (c.req.header("x-agentd-hook-token") !== deps.hookToken) {
        return c.body(null, 401);
      }

      try {
        const form = new URLSearchParams(await c.req.text());
        const event = form.get("event");
        const client = form.get("client");
        if (!isAgentdHookEvent(event) || !client) return c.body(null, 400);
        deps.handleTmuxHook(event, client);
        return c.body(null, 204);
      } catch {
        return c.body(null, 400);
      }
    });
}

export type AgentdApp = ReturnType<typeof createAgentdApp>;

function isAgentdHookEvent(value: string | null): value is AgentdHookEvent {
  return value === "client-attached"
    || value === "client-active"
    || value === "client-resized"
    || value === "client-focus-in"
    || value === "client-detached";
}

function toUnavailableError(error: unknown): { error: "agentd_unavailable"; message: string } {
  return {
    error: "agentd_unavailable",
    message: error instanceof Error ? error.message : String(error),
  };
}
