import {
  createAgentdClient,
  type AgentdConnection,
} from "@mobile-agent/agentd-client";
import type { CreatePaneRequest, CreateSessionRequest, PaneSummary, RegisterWorkspaceRequest, TmuxSession, TerminalEndpoint, WorkspaceDirectory } from "@mobile-agent/protocol";

export function getAgentdWebSocketEndpoint(connection: AgentdConnection): string {
  return connection.websocketUrl;
}

export function openAgentdEvents(connection: AgentdConnection): Promise<WebSocket> {
  return agentdClient(connection).openEvents();
}

export function openAgentdTerminal(connection: AgentdConnection): Promise<WebSocket> {
  return agentdClient(connection).openTerminal();
}

function agentdClient(connection: AgentdConnection) {
  return createAgentdClient(connection);
}

export function fetchTerminals(connection: AgentdConnection): Promise<TerminalEndpoint[]> {
  return agentdClient(connection).terminals();
}

export function fetchWorkspaces(connection: AgentdConnection): Promise<WorkspaceDirectory[]> {
  return agentdClient(connection).workspaces();
}

export function fetchWorkspaceDirectories(path: string | undefined, connection: AgentdConnection): Promise<WorkspaceDirectory[]> {
  return agentdClient(connection).browseWorkspaces(path);
}

export function registerWorkspace(input: RegisterWorkspaceRequest, connection: AgentdConnection): Promise<WorkspaceDirectory> {
  return agentdClient(connection).registerWorkspace(input);
}

export function fetchSessions(connection: AgentdConnection): Promise<TmuxSession[]> {
  return agentdClient(connection).sessions();
}

export function createSession(input: CreateSessionRequest, connection: AgentdConnection): Promise<TmuxSession> {
  return agentdClient(connection).createSession(input);
}

export function createPane(input: CreatePaneRequest, connection: AgentdConnection): Promise<PaneSummary> {
  return agentdClient(connection).createPane(input);
}

export function fetchPanes(sessionName: string | undefined, connection: AgentdConnection): Promise<PaneSummary[]> {
  return agentdClient(connection).panes(sessionName);
}
