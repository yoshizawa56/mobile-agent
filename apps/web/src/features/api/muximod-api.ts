import {
  createMuximodClient,
  type MuximodConnection,
} from "./muximod-client.js";
import type {
  CreatePaneRequest,
  CreateSessionRequest,
  MuximodEvent,
  PaneSummary,
  RegisterWorkspaceRequest,
  TmuxSession,
  TerminalEndpoint,
  UpdateWorkspaceRequest,
  WorkspaceDirectory,
} from "@muximo/api";

export function getMuximodWebSocketEndpoint(connection: MuximodConnection): string {
  return connection.websocketUrl;
}

export function openMuximodEvents(connection: MuximodConnection): Promise<AsyncIteratorObject<MuximodEvent>> {
  return muximodClient(connection).openEvents();
}

export function openMuximodTerminal(connection: MuximodConnection): Promise<WebSocket> {
  return muximodClient(connection).openTerminal();
}

function muximodClient(connection: MuximodConnection) {
  return createMuximodClient(connection);
}

export function fetchTerminals(connection: MuximodConnection): Promise<TerminalEndpoint[]> {
  return muximodClient(connection).terminals();
}

export function fetchWorkspaces(connection: MuximodConnection): Promise<WorkspaceDirectory[]> {
  return muximodClient(connection).workspaces();
}

export function fetchWorkspaceDirectories(path: string | undefined, connection: MuximodConnection): Promise<WorkspaceDirectory[]> {
  return muximodClient(connection).browseWorkspaces(path);
}

export function registerWorkspace(input: RegisterWorkspaceRequest, connection: MuximodConnection): Promise<WorkspaceDirectory> {
  return muximodClient(connection).registerWorkspace(input);
}

export function updateWorkspace(workspaceId: string, input: UpdateWorkspaceRequest, connection: MuximodConnection): Promise<WorkspaceDirectory> {
  return muximodClient(connection).updateWorkspace(workspaceId, input);
}

export function deleteWorkspace(workspaceId: string, connection: MuximodConnection): Promise<void> {
  return muximodClient(connection).deleteWorkspace(workspaceId);
}

export function fetchSessions(connection: MuximodConnection): Promise<TmuxSession[]> {
  return muximodClient(connection).sessions();
}

export function createSession(input: CreateSessionRequest, connection: MuximodConnection): Promise<TmuxSession> {
  return muximodClient(connection).createSession(input);
}

export function createPane(input: CreatePaneRequest, connection: MuximodConnection): Promise<PaneSummary> {
  return muximodClient(connection).createPane(input);
}

export function fetchPanes(sessionName: string | undefined, connection: MuximodConnection): Promise<PaneSummary[]> {
  return muximodClient(connection).panes(sessionName);
}
