export type ProductStage =
  | "terminals"
  | "sessions"
  | "connecting"
  | "disconnected"
  | "ended"
  | "settings"
  | "workspaces"
  | "workspace-detail"
  | "new-session"
  | "new-pane"
  | "session-overview"
  | "control-room";

export type WorkspaceRoute = {
  stage: ProductStage;
  terminalId: string | null;
  sessionName: string | null;
  paneId: string | null;
  workspaceId: string | null;
};

export function parseWorkspaceRoute(pathname: string): WorkspaceRoute {
  const segments = pathname.split("/").filter(Boolean).map(decodeRouteSegment);

  if (segments[0] === "workspaces") {
    if (segments[1]) return { stage: "workspace-detail", terminalId: null, sessionName: null, paneId: null, workspaceId: segments[1] };
    return emptyWorkspaceRoute("workspaces");
  }
  if (segments[0] === "settings") return emptyWorkspaceRoute("settings");
  if (segments[0] !== "terminals" || !segments[1]) return emptyWorkspaceRoute("terminals");

  const terminalId = segments[1];
  if (segments[2] !== "sessions") return emptyWorkspaceRoute("sessions", terminalId);
  if (!segments[3]) return emptyWorkspaceRoute("sessions", terminalId);
  if (segments[3] === "new") return emptyWorkspaceRoute("new-session", terminalId);

  const sessionName = segments[3];
  const suffix = segments[4];
  if (!suffix) return { stage: "session-overview", terminalId, sessionName, paneId: null, workspaceId: null };
  if (suffix === "connecting" || suffix === "disconnected" || suffix === "ended") {
    return { stage: suffix, terminalId, sessionName, paneId: null, workspaceId: null };
  }
  if (suffix !== "panes") return { stage: "session-overview", terminalId, sessionName, paneId: null, workspaceId: null };
  if (segments[5] === "new") return { stage: "new-pane", terminalId, sessionName, paneId: null, workspaceId: null };
  if (segments[5]) return { stage: "control-room", terminalId, sessionName, paneId: segments[5], workspaceId: null };
  return { stage: "session-overview", terminalId, sessionName, paneId: null, workspaceId: null };
}

export function terminalsPath(): string {
  return "/terminals";
}

export function settingsPath(): string {
  return "/settings";
}

export function sessionsPath(terminalId: string): string {
  return `/terminals/${encodeRouteSegment(terminalId)}/sessions`;
}

export function newSessionPath(terminalId: string): string {
  return `${sessionsPath(terminalId)}/new`;
}

export function sessionPath(terminalId: string, sessionName: string): string {
  return `${sessionsPath(terminalId)}/${encodeRouteSegment(sessionName)}`;
}

export function connectingPath(terminalId: string, sessionName: string): string {
  return `${sessionPath(terminalId, sessionName)}/connecting`;
}

export function disconnectedPath(terminalId: string, sessionName: string): string {
  return `${sessionPath(terminalId, sessionName)}/disconnected`;
}

export function endedPath(terminalId: string, sessionName: string): string {
  return `${sessionPath(terminalId, sessionName)}/ended`;
}

export function newPanePath(terminalId: string, sessionName: string): string {
  return `${sessionPath(terminalId, sessionName)}/panes/new`;
}

export function panePath(terminalId: string, sessionName: string, paneId: string): string {
  return `${sessionPath(terminalId, sessionName)}/panes/${encodeRouteSegment(paneId)}`;
}

export function workspacesPath(): string {
  return "/workspaces";
}

export function workspaceDetailPath(workspaceId: string): string {
  return `/workspaces/${encodeRouteSegment(workspaceId)}`;
}

function emptyWorkspaceRoute(stage: ProductStage, terminalId: string | null = null): WorkspaceRoute {
  return { stage, terminalId, sessionName: null, paneId: null, workspaceId: null };
}

function encodeRouteSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
