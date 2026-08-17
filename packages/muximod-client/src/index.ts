import { hc } from "hono/client";
import type { MuximodApp } from "@muximo/muximod-http";
import {
  muximodCapabilitiesSchema,
  muximodHealthSchema,
  createPaneRequestSchema,
  createSessionRequestSchema,
  paneResponseSchema,
  paneListResponseSchema,
  registerWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  terminalListResponseSchema,
  workspaceBrowseResponseSchema,
  workspaceListResponseSchema,
  workspaceResponseSchema,
  type MuximodCapabilities,
  type MuximodHealth,
  type CreateSessionRequest,
  type CreatePaneRequest,
  type PaneSummary,
  type RegisterWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type TmuxSession,
  type TerminalEndpoint,
  type WorkspaceDirectory,
} from "@muximo/protocol";
import { z } from "zod";

export type MuximodRouteKind = "serve" | "same-origin" | "lan" | "ssh";

export type MuximodConnection = {
  httpBaseUrl: string;
  websocketUrl: string;
  eventsWebsocketUrl?: string;
  route?: MuximodRouteKind;
  auth?: MuximodAuthProvider;
  close?: () => Promise<void>;
};

export type MuximodAuthProvider = {
  getAccessToken: () => Promise<string>;
  getWebSocketTicket: (endpoint: "terminal" | "events") => Promise<string>;
};

export type MuximodRouteProvider = {
  kind: MuximodRouteKind;
  open: () => Promise<MuximodConnection>;
};

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
  const http = hc<MuximodApp>(ensureTrailingSlash(connection.httpBaseUrl), {
    headers: connection.auth
      ? async () => ({ authorization: `Bearer ${await connection.auth!.getAccessToken()}` })
      : undefined,
  });

  return {
    health: async (): Promise<MuximodHealth> => parseResponse(await http.health.$get(), muximodHealthSchema),
    capabilities: async (): Promise<MuximodCapabilities> => parseResponse(await http.api.capabilities.$get(), muximodCapabilitiesSchema),
    workspaces: async (): Promise<WorkspaceDirectory[]> => parseResponse(await http.api.workspaces.$get(), workspaceListResponseSchema).then((data) => data.workspaces),
    browseWorkspaces: async (path?: string): Promise<WorkspaceDirectory[]> => parseResponse(await http.api["workspace-directories"].$get({ query: path ? { path } : {} }), workspaceBrowseResponseSchema).then((data) => data.directories),
    registerWorkspace: async (input: RegisterWorkspaceRequest): Promise<WorkspaceDirectory> => {
      const validated = registerWorkspaceRequestSchema.parse(input);
      return parseResponse(await http.api.workspaces.$post({ json: validated }), workspaceResponseSchema).then((data) => data.workspace);
    },
    updateWorkspace: async (workspaceId: string, input: UpdateWorkspaceRequest): Promise<WorkspaceDirectory> => {
      const validated = updateWorkspaceRequestSchema.parse(input);
      return parseResponse(await http.api.workspaces[":workspaceId"].$patch({ param: { workspaceId }, json: validated }), workspaceResponseSchema).then((data) => data.workspace);
    },
    deleteWorkspace: async (workspaceId: string): Promise<void> => {
      await parseResponse(await http.api.workspaces[":workspaceId"].$delete({ param: { workspaceId } }), z.null());
    },
    terminals: async (): Promise<TerminalEndpoint[]> => parseResponse(await http.api.terminals.$get(), terminalListResponseSchema).then((data) => data.terminals),
    sessions: async (): Promise<TmuxSession[]> => parseResponse(await http.api.sessions.$get(), sessionListResponseSchema).then((data) => data.sessions),
    createSession: async (input: CreateSessionRequest): Promise<TmuxSession> => {
      const validated = createSessionRequestSchema.parse(input);
      return parseResponse(await http.api.sessions.$post({ json: validated }), sessionResponseSchema).then((data) => data.session);
    },
    panes: async (sessionName?: string): Promise<PaneSummary[]> => {
      const response = sessionName
        ? await http.api.panes.$get({ query: { session: sessionName } })
        : await http.api.panes.$get({ query: {} });
      return parseResponse(response, paneListResponseSchema).then((data) => data.panes);
    },
    createPane: async (input: CreatePaneRequest): Promise<PaneSummary> => {
      const validated = createPaneRequestSchema.parse(input);
      return parseResponse(await http.api.panes.$post({ json: validated }), paneResponseSchema).then((data) => data.pane);
    },
    openTerminal: async (): Promise<WebSocket> => new WebSocket(await websocketEndpoint(connection, "terminal")),
    openEvents: async (): Promise<WebSocket> => new WebSocket(await websocketEndpoint(connection, "events")),
    connection,
  };
}

async function websocketEndpoint(connection: MuximodConnection, endpoint: "terminal" | "events"): Promise<string> {
  const base = endpoint === "terminal" ? connection.websocketUrl : connection.eventsWebsocketUrl ?? eventWebSocketUrl(connection.websocketUrl);
  if (!connection.auth) return base;
  const url = new URL(base);
  url.searchParams.set("ticket", await connection.auth.getWebSocketTicket(endpoint));
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
  return { httpBaseUrl, websocketUrl, eventsWebsocketUrl: `${websocketProtocol}//${url.host}${normalizedPath}/events`, route };
}

function eventWebSocketUrl(terminalWebSocketUrl: string): string {
  const url = new URL(terminalWebSocketUrl);
  if (url.pathname.endsWith("/terminal")) {
    url.pathname = `${url.pathname.slice(0, -"/terminal".length)}/events`;
  } else {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/events`;
  }
  return url.toString();
}

function ensureTrailingSlash(value: string): string {
  if (!value) return "/";
  return value.endsWith("/") ? value : `${value}/`;
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MuximodApiError(
      apiErrorMessage(payload) ?? `muximod returned ${response.status}`,
      response.status,
      apiErrorCode(payload),
      apiErrorDetails(payload),
    );
  }
  return schema.parse(payload);
}

function apiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("message" in payload)) return null;
  const message = payload.message;
  return typeof message === "string" ? message : null;
}

function apiErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
  const code = payload.error;
  return typeof code === "string" ? code : null;
}

function apiErrorDetails(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || !("details" in payload)) return null;
  const details = payload.details;
  return details && typeof details === "object" ? details as Record<string, unknown> : null;
}
