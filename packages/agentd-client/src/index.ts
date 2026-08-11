import { hc } from "hono/client";
import type { AgentdApp } from "@mobile-agent/agentd/server";
import {
  agentdCapabilitiesSchema,
  agentdHealthSchema,
  createPaneRequestSchema,
  createSessionRequestSchema,
  paneResponseSchema,
  paneListResponseSchema,
  projectListResponseSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  terminalListResponseSchema,
  workspaceListResponseSchema,
  type AgentdCapabilities,
  type AgentdHealth,
  type CreateSessionRequest,
  type CreatePaneRequest,
  type PaneSummary,
  type ProjectOption,
  type TmuxSession,
  type TerminalEndpoint,
  type WorkspaceDirectory,
} from "@mobile-agent/protocol";
import type { z } from "zod";

export type AgentdRouteKind = "serve" | "same-origin" | "lan" | "ssh";

export type AgentdConnection = {
  httpBaseUrl: string;
  websocketUrl: string;
  eventsWebsocketUrl?: string;
  route?: AgentdRouteKind;
  close?: () => Promise<void>;
};

export type AgentdRouteProvider = {
  kind: AgentdRouteKind;
  open: () => Promise<AgentdConnection>;
};

export type AgentdClient = ReturnType<typeof createAgentdClient>;

export class AgentdApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly details: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "AgentdApiError";
  }
}

/**
 * Creates the browser/native standard connection through Tailscale Serve.
 * SSH is deliberately not part of this helper: a native RouteProvider can
 * create a local forward and pass its resulting URLs to createAgentdClient.
 */
export function createServeConnection(serveUrl: string): AgentdConnection {
  return createUrlConnection(serveUrl, "serve");
}

export function createSameOriginConnection(origin: string): AgentdConnection {
  return createUrlConnection(origin, "same-origin");
}

export function createAgentdClient(connection: AgentdConnection) {
  const http = hc<AgentdApp>(ensureTrailingSlash(connection.httpBaseUrl));

  return {
    health: async (): Promise<AgentdHealth> => parseResponse(await http.health.$get(), agentdHealthSchema),
    capabilities: async (): Promise<AgentdCapabilities> => parseResponse(await http.api.capabilities.$get(), agentdCapabilitiesSchema),
    workspaces: async (): Promise<WorkspaceDirectory[]> => parseResponse(await http.api.workspaces.$get(), workspaceListResponseSchema).then((data) => data.workspaces),
    projects: async (): Promise<ProjectOption[]> => parseResponse(await http.api.projects.$get(), projectListResponseSchema).then((data) => data.projects),
    terminals: async (): Promise<TerminalEndpoint[]> => parseResponse(await http.api.terminals.$get(), terminalListResponseSchema).then((data) => data.terminals),
    sessions: async (): Promise<TmuxSession[]> => parseResponse(await http.api.sessions.$get(), sessionListResponseSchema).then((data) => data.sessions),
    createSession: async (input: CreateSessionRequest): Promise<TmuxSession> => {
      const validated = createSessionRequestSchema.parse(input);
      return parseResponse(await http.api.sessions.$post({ json: validated }), sessionResponseSchema).then((data) => data.session);
    },
    panes: async (sessionName?: string): Promise<PaneSummary[]> => {
      const response = sessionName
        ? await http.api.panes.$get({ query: { session: sessionName } })
        : await http.api.panes.$get();
      return parseResponse(response, paneListResponseSchema).then((data) => data.panes);
    },
    createPane: async (input: CreatePaneRequest): Promise<PaneSummary> => {
      const validated = createPaneRequestSchema.parse(input);
      return parseResponse(await http.api.panes.$post({ json: validated }), paneResponseSchema).then((data) => data.pane);
    },
    openTerminal: (): WebSocket => new WebSocket(connection.websocketUrl),
    openEvents: (): WebSocket => new WebSocket(connection.eventsWebsocketUrl ?? eventWebSocketUrl(connection.websocketUrl)),
    connection,
  };
}

function createUrlConnection(baseUrl: string, route: AgentdRouteKind): AgentdConnection {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`agentd URL must use http or https: ${baseUrl}`);
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
    throw new AgentdApiError(
      apiErrorMessage(payload) ?? `agentd returned ${response.status}`,
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
