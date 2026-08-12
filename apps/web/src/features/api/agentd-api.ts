import {
  createAgentdClient,
  createSameOriginConnection,
  createServeConnection,
  type AgentdConnection,
} from "@mobile-agent/agentd-client";
import type { CreatePaneRequest, CreateSessionRequest, PaneSummary, RegisterWorkspaceRequest, TmuxSession, TerminalEndpoint, WorkspaceDirectory } from "@mobile-agent/protocol";

export function getAgentdConnection(serveUrl?: string): AgentdConnection {
  const httpOverride = import.meta.env.VITE_AGENTD_HTTP_URL as string | undefined;
  const websocketOverride = import.meta.env.VITE_AGENTD_WS_URL as string | undefined;
  if (serveUrl && !httpOverride && !websocketOverride) return createServeConnection(serveUrl);

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const sameOrigin = window.location.origin;

  if (httpOverride || websocketOverride) return {
    httpBaseUrl: httpOverride?.replace(/\/$/, "") ?? sameOrigin,
    websocketUrl: websocketOverride ?? `${protocol}//${window.location.host}/terminal`,
    route: httpOverride ? undefined : "same-origin",
  };

  return createSameOriginConnection(sameOrigin);
}

export function getAgentdWebSocketEndpoint(connection?: AgentdConnection): string {
  return (connection ?? getAgentdConnection()).websocketUrl;
}

export function openAgentdEvents(connection?: AgentdConnection): WebSocket {
  return agentdClient(connection).openEvents();
}

function agentdClient(connection?: AgentdConnection) {
  return createAgentdClient(connection ?? getAgentdConnection());
}

export function fetchTerminals(connection?: AgentdConnection): Promise<TerminalEndpoint[]> {
  return agentdClient(connection).terminals();
}

export function fetchWorkspaces(connection?: AgentdConnection): Promise<WorkspaceDirectory[]> {
  return agentdClient(connection).workspaces();
}

export function fetchWorkspaceDirectories(path?: string, connection?: AgentdConnection): Promise<WorkspaceDirectory[]> {
  return agentdClient(connection).browseWorkspaces(path);
}

export function registerWorkspace(input: RegisterWorkspaceRequest, connection?: AgentdConnection): Promise<WorkspaceDirectory> {
  return agentdClient(connection).registerWorkspace(input);
}

export function fetchSessions(connection?: AgentdConnection): Promise<TmuxSession[]> {
  return agentdClient(connection).sessions();
}

export function createSession(input: CreateSessionRequest, connection?: AgentdConnection): Promise<TmuxSession> {
  return agentdClient(connection).createSession(input);
}

export function createPane(input: CreatePaneRequest, connection?: AgentdConnection): Promise<PaneSummary> {
  return agentdClient(connection).createPane(input);
}

export function fetchPanes(sessionName?: string, connection?: AgentdConnection): Promise<PaneSummary[]> {
  return agentdClient(connection).panes(sessionName);
}
