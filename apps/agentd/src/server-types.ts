import type { Hono } from "hono";
import type {
  AgentdCapabilities,
  AgentdHealth,
  AuthChallengeRequest,
  AuthChallengeResponse,
  AuthInfo,
  AuthSessionRequest,
  AuthSessionResponse,
  CreatePaneRequest,
  CreateSessionRequest,
  PairingClaimRequest,
  PairingClaimResponse,
  PairingStatus,
  PaneSummary,
  RegisterWorkspaceRequest,
  TerminalEndpoint,
  TmuxSession,
  WorkspaceDirectory,
  WsTicketRequest,
  WsTicketResponse,
} from "@mobile-agent/protocol";

/**
 * Type-only public surface for the server package.
 *
 * Keeping this separate from server.ts prevents browser/client type checking
 * from traversing Bun-native PTY and SQLite implementation modules.
 */

export type AgentdOptions = {
  host: string;
  port: number;
  databaseFile?: string;
  corsOrigin?: string;
  allowedRoots?: string[];
  controlSocket?: string;
  webOrigin?: string;
  agentdBaseUrl?: string;
};

type ApiError = {
  error: string;
  message: string;
  details?: Record<string, unknown>;
};

type Status = 200 | 201 | 204 | 400 | 401 | 404 | 409 | 410 | 429 | 503;

type JsonEndpoint<Output, Input = {}, ResponseStatus extends Status = 200> = {
  input: Input;
  output: Output;
  outputFormat: "json";
  status: ResponseStatus;
};

type AgentdRoutes = {
  "/auth/v1/info": {
    $get: JsonEndpoint<AuthInfo | ApiError, {}, 200 | 503>;
  };
  "/auth/v1/pairings/:pairingId/claim": {
    $post: JsonEndpoint<PairingClaimResponse | ApiError, { param: { pairingId: string }; json: PairingClaimRequest }, 201 | 400 | 401 | 404 | 409 | 410 | 429 | 503>;
  };
  "/auth/v1/pairings/:pairingId": {
    $get: JsonEndpoint<PairingStatus | ApiError, { param: { pairingId: string } }, 200 | 400 | 401 | 404 | 410 | 503>;
  };
  "/auth/v1/challenges": {
    $post: JsonEndpoint<AuthChallengeResponse | ApiError, { json: AuthChallengeRequest }, 201 | 400 | 401 | 404 | 410 | 429 | 503>;
  };
  "/auth/v1/sessions": {
    $post: JsonEndpoint<AuthSessionResponse | ApiError, { json: AuthSessionRequest }, 201 | 400 | 401 | 404 | 410 | 429 | 503>;
  };
  "/auth/v1/ws-tickets": {
    $post: JsonEndpoint<WsTicketResponse | ApiError, { json: WsTicketRequest }, 201 | 400 | 401 | 503>;
  };
  "/health": {
    $get: JsonEndpoint<AgentdHealth | ApiError, {}, 200 | 503>;
  };
  "/api/capabilities": {
    $get: JsonEndpoint<AgentdCapabilities | ApiError, {}, 200 | 401 | 503>;
  };
  "/api/workspaces": {
    $get: JsonEndpoint<{ workspaces: WorkspaceDirectory[] } | ApiError, {}, 200 | 401 | 503>;
    $post: JsonEndpoint<{ workspace: WorkspaceDirectory } | ApiError, { json: RegisterWorkspaceRequest }, 201 | 400 | 401 | 503>;
  };
  "/api/workspace-directories": {
    $get: JsonEndpoint<{ directories: WorkspaceDirectory[] } | ApiError, { query?: { path?: string } }, 200 | 400 | 401 | 503>;
  };
  "/api/terminals": {
    $get: JsonEndpoint<{ terminals: TerminalEndpoint[] } | ApiError, {}, 200 | 401 | 503>;
  };
  "/api/sessions": {
    $get: JsonEndpoint<{ sessions: TmuxSession[] } | ApiError, {}, 200 | 401 | 503>;
    $post: JsonEndpoint<{ session: TmuxSession } | ApiError, { json: CreateSessionRequest }, 201 | 400 | 401 | 404 | 409 | 503>;
  };
  "/api/panes": {
    $get: JsonEndpoint<{ panes: PaneSummary[] } | ApiError, { query?: { session?: string } }, 200 | 401 | 503>;
    $post: JsonEndpoint<{ pane: PaneSummary } | ApiError, { json: CreatePaneRequest }, 201 | 400 | 401 | 404 | 503>;
  };
};

export type AgentdApp = Hono<{ Variables: { auth: unknown } }, AgentdRoutes>;
