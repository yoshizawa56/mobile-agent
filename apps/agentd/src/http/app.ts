import { cors } from "hono/cors";
import { Hono } from "hono";
import type { WorkspaceRecord, WorkspaceSelection } from "@mobile-agent/domain";
import type { CreatePaneRequest, PaneSummary, RegisterWorkspaceRequest, TmuxSession, TerminalEndpoint, WorkspaceDirectory } from "@mobile-agent/protocol";
import { agentdCapabilitiesSchema, agentdHealthSchema, createPaneRequestSchema, createSessionRequestSchema, paneResponseSchema, registerWorkspaceRequestSchema, workspaceBrowseResponseSchema, workspaceListResponseSchema, workspaceResponseSchema } from "@mobile-agent/protocol";

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
  listWorkspaceDirectories: () => Promise<WorkspaceDirectory[]>;
  browseWorkspaceDirectories: (parentPath?: string) => Promise<WorkspaceDirectory[]>;
  registerWorkspace: (input: RegisterWorkspaceRequest) => Promise<WorkspaceDirectory>;
  resolveWorkspaceDirectory: (workspaceId: string) => Promise<WorkspaceRecord>;
  resolveWorkspaceSelection: (selection: WorkspaceSelection) => Promise<WorkspaceRecord>;
  listSessions: () => Promise<TmuxSession[]>;
  createSession: (input: { name: string; cwd: string; workspaceId?: string }) => Promise<TmuxSession>;
  listPanes: (sessionName?: string) => Promise<PaneSummary[]>;
  createPane: (input: CreatePaneRequest, workspace?: WorkspaceRecord) => Promise<PaneSummary>;
  handleTmuxHook: (event: AgentdHookEvent, client: string) => void;
};

export class AgentdHttpError extends Error {
  public constructor(
    public readonly status: 400 | 404 | 409 | 503,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
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
          resourceInvalidationEvents: true,
        },
      };
      return c.json(agentdCapabilitiesSchema.parse(response));
    })
    .get("/api/workspaces", async (c) => {
      try {
        return c.json(workspaceListResponseSchema.parse({ workspaces: await deps.listWorkspaceDirectories() }));
      } catch (error) {
        return c.json(toUnavailableError(error), 503);
      }
    })
    .get("/api/workspace-directories", async (c) => {
      try {
        const parentPath = c.req.query("path") || undefined;
        return c.json(workspaceBrowseResponseSchema.parse({ directories: await deps.browseWorkspaceDirectories(parentPath) }));
      } catch (error) {
        const httpError = toHttpError(error);
        if (httpError) return c.json(errorResponse(httpError), httpError.status);
        return c.json(toUnavailableError(error), 503);
      }
    })
    .post("/api/workspaces", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_request", message: "Request body must be valid JSON" }, 400);
      }

      const parsed = registerWorkspaceRequestSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
      try {
        return c.json(workspaceResponseSchema.parse({ workspace: await deps.registerWorkspace(parsed.data) }), 201);
      } catch (error) {
        const httpError = toHttpError(error);
        if (httpError) return c.json(errorResponse(httpError), httpError.status);
        return c.json(toUnavailableError(error), 503);
      }
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
        const input = parsed.data.workspaceId
          ? await deps.resolveWorkspaceDirectory(parsed.data.workspaceId).then((workspace) => ({
              name: parsed.data.name,
              workspaceId: parsed.data.workspaceId!,
              cwd: workspace.rootPath,
            }))
          : { name: parsed.data.name, cwd: parsed.data.cwd! };
        return c.json({ session: await deps.createSession(input) }, 201);
      } catch (error) {
        const httpError = toHttpError(error);
        if (httpError) return c.json(errorResponse(httpError), httpError.status);
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
        const workspace = parsed.data.workspaceId
          ? await deps.resolveWorkspaceSelection({
              workspaceId: parsed.data.workspaceId,
              mode: parsed.data.useWorktree ? "worktree" : "workspace",
            })
          : undefined;
        const input = workspace ? { ...parsed.data, cwd: workspace.rootPath } : parsed.data;
        return c.json(paneResponseSchema.parse({ pane: await deps.createPane(input, workspace) }), 201);
      } catch (error) {
        const httpError = toHttpError(error);
        if (httpError) return c.json(errorResponse(httpError), httpError.status);
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

function toHttpError(error: unknown): AgentdHttpError | undefined {
  if (error instanceof AgentdHttpError) return error;
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const code = error.code;
    const message = error.message;
    if (typeof code === "string" && typeof message === "string") {
      const details = "details" in error && error.details && typeof error.details === "object"
        ? error.details as Record<string, unknown>
        : undefined;
      return new AgentdHttpError(400, code, message, details);
    }
  }
  return undefined;
}

function errorResponse(error: AgentdHttpError): { error: string; message: string; details?: Record<string, unknown> } {
  return {
    error: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}
