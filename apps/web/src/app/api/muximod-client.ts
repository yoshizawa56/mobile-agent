import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { muximodContract } from "@muximo/contract";
import {
  createPaneRequestSchema,
  createSessionRequestSchema,
  registerWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  type CreatePaneRequest,
  type CreateSessionRequest,
  type MuximodCapabilities,
  type MuximodEvent,
  type MuximodHealth,
  type PaneSummary,
  type RegisterWorkspaceRequest,
  type TerminalEndpoint,
  type TmuxSession,
  type UpdateWorkspaceRequest,
  type WorkspaceDirectory,
} from "@muximo/contract";

export type MuximodRouteKind = "serve" | "same-origin" | "lan" | "ssh";

export type MuximodConnection = {
  httpBaseUrl: string;
  websocketUrl: string;
  route?: MuximodRouteKind;
  auth?: MuximodAuthProvider;
  close?: () => Promise<void>;
};

export type MuximodAuthProvider = {
  getAccessToken: () => Promise<string>;
  getWebSocketTicket: (endpoint: "terminal") => Promise<string>;
};

export type MuximodRouteProvider = {
  kind: MuximodRouteKind;
  open: () => Promise<MuximodConnection>;
};

type MuximodClientContext = {
  pairingToken?: string;
};

type MuximodRpcClient = ContractRouterClient<typeof muximodContract, MuximodClientContext>;

export type MuximodClient = ReturnType<typeof createMuximodClient>;

export class MuximodApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly details: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "MuximodApiError";
  }
}

/**
 * Creates the browser/native standard connection through Tailscale Serve.
 * SSH is deliberately not part of this helper: a native RouteProvider can
 * create a local forward and pass its resulting URLs to createMuximodClient.
 */
export function createServeConnection(serveUrl: string): MuximodConnection {
  return createUrlConnection(serveUrl, "serve");
}

export function createSameOriginConnection(origin: string): MuximodConnection {
  return createUrlConnection(origin, "same-origin");
}

export function createMuximodClient(connection: MuximodConnection) {
  const rpc = createRpcClient(connection);

  return {
    health: (): Promise<MuximodHealth> => callRpc(() => rpc.health({})),
    capabilities: (): Promise<MuximodCapabilities> => callRpc(() => rpc.capabilities({})),
    workspaces: async (): Promise<WorkspaceDirectory[]> => (await callRpc(() => rpc.workspaces.list({}))).workspaces,
    browseWorkspaces: async (path?: string): Promise<WorkspaceDirectory[]> => (await callRpc(() => rpc.workspaces.browse(path ? { path } : {}))).directories,
    registerWorkspace: async (input: RegisterWorkspaceRequest): Promise<WorkspaceDirectory> => {
      const validated = registerWorkspaceRequestSchema.parse(input);
      return (await callRpc(() => rpc.workspaces.register(validated))).workspace;
    },
    updateWorkspace: async (workspaceId: string, input: UpdateWorkspaceRequest): Promise<WorkspaceDirectory> => {
      const validated = updateWorkspaceRequestSchema.parse(input);
      return (await callRpc(() => rpc.workspaces.update({ workspaceId, input: validated }))).workspace;
    },
    deleteWorkspace: async (workspaceId: string): Promise<void> => {
      await callRpc(() => rpc.workspaces.delete({ workspaceId }));
    },
    terminals: async (): Promise<TerminalEndpoint[]> => (await callRpc(() => rpc.terminals.list({}))).terminals,
    sessions: async (): Promise<TmuxSession[]> => (await callRpc(() => rpc.sessions.list({}))).sessions,
    createSession: async (input: CreateSessionRequest): Promise<TmuxSession> => {
      const validated = createSessionRequestSchema.parse(input);
      return (await callRpc(() => rpc.sessions.create(validated))).session;
    },
    panes: async (sessionName?: string): Promise<PaneSummary[]> => (await callRpc(() => rpc.panes.list(sessionName ? { session: sessionName } : {}))).panes,
    createPane: async (input: CreatePaneRequest): Promise<PaneSummary> => {
      const validated = createPaneRequestSchema.parse(input);
      return (await callRpc(() => rpc.panes.create(validated))).pane;
    },
    authInfo: () => callRpc(() => rpc.auth.info({})),
    claimPairing: (pairingId: string, request: Parameters<MuximodRpcClient["auth"]["claimPairing"]>[0]["request"]) => callRpc(() => rpc.auth.claimPairing({ pairingId, request })),
    pairingStatus: (pairingId: string, claimToken: string) => callRpc(() => rpc.auth.pairingStatus({ pairingId, claimToken }, { context: { pairingToken: claimToken } })),
    createChallenge: (deviceId: string) => callRpc(() => rpc.auth.createChallenge({ deviceId })),
    createAuthSession: (input: Parameters<MuximodRpcClient["auth"]["createSession"]>[0]) => callRpc(() => rpc.auth.createSession(input)),
    issueWebSocketTicket: (endpoint: "terminal") => callRpc(() => rpc.auth.issueWebSocketTicket({ endpoint })),
    openTerminal: async (): Promise<WebSocket> => new WebSocket(await websocketEndpoint(connection)),
    openEvents: (): Promise<AsyncIteratorObject<MuximodEvent>> => callRpc(() => rpc.events.subscribe({})),
    connection,
  };
}

function createRpcClient(connection: MuximodConnection): MuximodRpcClient {
  const link = new RPCLink<MuximodClientContext>({
    url: `${ensureTrailingSlash(connection.httpBaseUrl)}rpc`,
    headers: async ({ context }) => {
      const headers: Record<string, string> = {};
      if (connection.auth) headers.authorization = `Bearer ${await connection.auth.getAccessToken()}`;
      if (context.pairingToken) headers["x-muximod-pairing-token"] = context.pairingToken;
      return headers;
    },
  });
  return createORPCClient<MuximodRpcClient>(link);
}

async function websocketEndpoint(connection: MuximodConnection): Promise<string> {
  if (!connection.auth) return connection.websocketUrl;
  const url = new URL(connection.websocketUrl);
  url.searchParams.set("ticket", await connection.auth.getWebSocketTicket("terminal"));
  return url.toString();
}

function createUrlConnection(baseUrl: string, route: MuximodRouteKind): MuximodConnection {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`muximod URL must use http or https: ${baseUrl}`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  const httpBaseUrl = `${url.origin}${normalizedPath}`;
  const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  const websocketUrl = `${websocketProtocol}//${url.host}${normalizedPath}/terminal`;
  return { httpBaseUrl, websocketUrl, route };
}

function ensureTrailingSlash(value: string): string {
  if (!value) return "/";
  return value.endsWith("/") ? value : `${value}/`;
}

async function callRpc<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ORPCError) {
      const data = isRecord(error.data) ? error.data : {};
      const details = isRecord(data.details) ? data.details : null;
      throw new MuximodApiError(
        error.message,
        error.status,
        typeof data.code === "string" ? data.code : null,
        details,
      );
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
