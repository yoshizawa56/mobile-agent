import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { PanePlacement, PaneSummary, TmuxSession } from "@mobile-agent/protocol";
import { fetchPanes, fetchProjects, fetchSessions, fetchTerminals, fetchWorkspaces, createPane, createSession, getAgentdConnection } from "../api/agentd-api";
import type { ConnectionFlowStage, ConnectionFlowViewModel, TerminalEndpoint } from "../connection/connection-flow-viewmodel";
import type { ConnectionSettingsViewModel } from "../connection/connection-settings-viewmodel";
import type { ProductStage } from "../../app/workspace-routes";
import {
  clearBrowserConnectionProfile,
  connectionForProfile,
  readBrowserConnectionProfile,
  saveBrowserConnectionProfile,
  type BrowserConnectionProfile,
} from "../connection/connection-profile-store";
import type { NewSessionViewModel } from "../session/new-session-viewmodel";
import type { SessionOverviewViewModel } from "../session/session-overview-viewmodel";
import type { NewPaneAgent, NewPaneKind, NewPaneViewModel } from "../pane/new-pane-viewmodel";
import type { WorkspaceSelectionMode } from "../workspace/workspace-picker-viewmodel";
import { paneQueryKey, usePaneBoardViewModel } from "../pane-board/pane-board-viewmodel";
import { usePaneViewModel } from "../pane/pane-viewmodel";
import {
  connectingPath,
  disconnectedPath,
  newPanePath,
  newSessionPath,
  panePath,
  parseWorkspaceRoute,
  sessionPath,
  sessionsPath,
  settingsPath,
  terminalsPath,
} from "../../app/workspace-routes";
import { useAgentdEvents } from "../api/agentd-events";

export type { ProductStage } from "../../app/workspace-routes";

export type MobileExperienceViewModel = {
  stage: ProductStage;
  connection: ConnectionFlowViewModel;
  connectionSettings: ConnectionSettingsViewModel;
  newSession: NewSessionViewModel;
  newPane: NewPaneViewModel;
  sessionOverview: SessionOverviewViewModel;
  terminalView: ReturnType<typeof usePaneViewModel>;
  paneBoard: ReturnType<typeof usePaneBoardViewModel>;
  onWorkspaceSwitch: () => void;
  onOpenNewPane: () => void;
};

export function useMobileExperienceViewModel(): MobileExperienceViewModel {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const route = useRouterState({ select: (state) => parseWorkspaceRoute(state.location.pathname) });
  const { stage, terminalId, sessionName, paneId: selectedPaneRouteId } = route;
  const [createdSession, setCreatedSession] = useState<TmuxSession | null>(null);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState("");
  const [newSessionError, setNewSessionError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newPaneName, setNewPaneName] = useState("");
  const [newPaneWorkspaceId, setNewPaneWorkspaceId] = useState("");
  const [newPaneKind, setNewPaneKind] = useState<NewPaneKind>("agent");
  const [newPaneAgent, setNewPaneAgent] = useState<NewPaneAgent>("codex");
  const [newPaneSelectionMode, setNewPaneSelectionMode] = useState<WorkspaceSelectionMode>("workspace");
  const [newPaneProjectId, setNewPaneProjectId] = useState<string | null>(null);
  const [newPanePlacement, setNewPanePlacement] = useState<PanePlacement>("window");
  const [newPaneTargetPaneId, setNewPaneTargetPaneId] = useState<string | null>(null);
  const [newPaneError, setNewPaneError] = useState<string | null>(null);
  const [isCreatingPane, setIsCreatingPane] = useState(false);
  const [connectionProfile, setConnectionProfile] = useState<BrowserConnectionProfile | null>(() => readBrowserConnectionProfile());
  const [connectionName, setConnectionName] = useState(() => readBrowserConnectionProfile()?.name ?? "");
  const [serveUrl, setServeUrl] = useState(() => readBrowserConnectionProfile()?.serveUrl ?? "");
  const [connectionSettingsError, setConnectionSettingsError] = useState<string | null>(null);
  const [isSavingConnection, setIsSavingConnection] = useState(false);

  const navigateTo = useCallback((path: string) => {
    void navigate({ to: path });
  }, [navigate]);

  const agentdConnection = useMemo(
    () => connectionForProfile(connectionProfile) ?? getAgentdConnection(),
    [connectionProfile],
  );
  const connectionKey = `${agentdConnection.route ?? "custom"}:${agentdConnection.httpBaseUrl}`;
  useAgentdEvents(agentdConnection, connectionKey);

  const terminalsQuery = useQuery({
    queryKey: ["terminals", connectionKey],
    queryFn: () => fetchTerminals(agentdConnection),
    staleTime: 5_000,
    retry: 1,
  });
  const terminals = terminalsQuery.data ?? [];
  const selectedTerminal = terminals.find((terminal) => terminal.id === terminalId) ?? null;

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", connectionKey],
    queryFn: () => fetchWorkspaces(agentdConnection),
    enabled: stage === "new-session" || stage === "new-pane",
    staleTime: 5_000,
    retry: 1,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", connectionKey],
    queryFn: () => fetchProjects(agentdConnection),
    enabled: stage === "new-pane",
    staleTime: 5_000,
    retry: 1,
  });
  const workspaces = workspacesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const workspaceStatus = queryStatus(workspacesQuery.status);
  const projectStatus = queryStatus(projectsQuery.status);
  const workspaceError = errorMessage(workspacesQuery.error);
  const projectError = errorMessage(projectsQuery.error);

  const sessionsQuery = useQuery({
    queryKey: ["sessions", connectionKey, terminalId],
    queryFn: () => fetchSessions(agentdConnection),
    enabled: Boolean(terminalId),
    staleTime: 1_000,
    refetchInterval: stage === "sessions" ? 5_000 : false,
    retry: 1,
  });
  const sessions = sessionsQuery.data ?? [];
  const selectedSession = createdSession?.name === sessionName
    ? createdSession
    : sessions.find((session) => session.name === sessionName) ?? null;

  const panesQuery = useQuery({
    queryKey: paneQueryKey(agentdConnection, selectedSession?.name),
    queryFn: () => fetchPanes(selectedSession!.name, agentdConnection),
    enabled: Boolean(selectedSession?.name) && (stage === "session-overview" || stage === "control-room" || stage === "new-pane"),
    staleTime: 1_000,
    refetchInterval: stage === "session-overview" ? 3_000 : false,
    retry: 1,
  });
  const sessionPanes = panesQuery.data ?? [];
  const selectedPane = selectedPaneRouteId
    ? sessionPanes.find((pane) => pane.id === selectedPaneRouteId || pane.tmuxPaneId === selectedPaneRouteId) ?? null
    : null;
  const selectedPaneId = selectedPane?.tmuxPaneId ?? (selectedPaneRouteId ? "" : sessionPanes[0]?.tmuxPaneId ?? "");
  const paneTarget = selectedPaneId;
  const terminalView = usePaneViewModel({ target: paneTarget, connection: agentdConnection });

  const paneBoard = usePaneBoardViewModel({
    selectedTarget: selectedPaneId ?? "",
    sessionName: selectedSession?.name,
    connection: agentdConnection,
    alwaysOpen: stage === "control-room",
    onSelect: (target) => {
      const pane = sessionPanes.find((candidate) => candidate.tmuxPaneId === target);
      if (terminalId && sessionName && pane) navigateTo(panePath(terminalId, sessionName, pane.id));
    },
  });

  useEffect(() => {
    if (stage !== "connecting") return;
    const timer = window.setTimeout(() => {
      if (terminalId && sessionName) navigateTo(sessionPath(terminalId, sessionName));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [navigate, navigateTo, sessionName, stage, terminalId]);

  const connection = useMemo<ConnectionFlowViewModel>(() => ({
    stage: isConnectionStage(stage) ? stage : "terminals",
    terminals,
    sessions,
    selectedTerminal,
    selectedSession,
    connectionStep: stage === "connecting" ? 2 : 0,
    status: stage === "terminals" ? queryStatus(terminalsQuery.status) : queryStatus(sessionsQuery.status),
    errorMessage: stage === "terminals" ? errorMessage(terminalsQuery.error) : errorMessage(sessionsQuery.error),
    onSelectTerminal: (terminal) => {
      setCreatedSession(null);
      navigateTo(sessionsPath(terminal.id));
    },
    onSelectSession: (session) => {
      if (terminalId) navigateTo(connectingPath(terminalId, session.name));
    },
    onCreateSession: () => {
      setNewSessionError(null);
      setNewSessionName("");
      setNewSessionWorkspaceId("");
      if (terminalId) navigateTo(newSessionPath(terminalId));
    },
    onBack: () => navigateTo(stage === "connecting" && terminalId ? sessionsPath(terminalId) : terminalsPath()),
    onOpenSessionOverview: () => {
      if (terminalId && sessionName) navigateTo(sessionPath(terminalId, sessionName));
    },
    onDisconnect: () => {
      if (terminalId && sessionName) navigateTo(disconnectedPath(terminalId, sessionName));
    },
    onReconnect: () => {
      if (terminalId && sessionName) navigateTo(connectingPath(terminalId, sessionName));
    },
    onChooseTerminal: () => navigateTo(terminalsPath()),
    onOpenSettings: () => {
      setConnectionSettingsError(null);
      navigateTo(settingsPath());
    },
  }), [navigate, selectedSession, selectedTerminal, sessions, sessionsQuery.error, sessionsQuery.status, stage, terminalId, terminals, terminalsQuery.error, terminalsQuery.status, sessionName]);

  const newSession = useMemo<NewSessionViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    name: newSessionName,
    workspacePicker: {
      workspaces,
      projects: [],
      workspaceId: newSessionWorkspaceId || workspaces[0]?.id || "",
      mode: "workspace",
      projectId: null,
      workspaceStatus,
      projectStatus: "ready",
      errorMessage: workspaceError,
      onWorkspaceChange: setNewSessionWorkspaceId,
      onModeChange: () => undefined,
      onProjectChange: () => undefined,
    },
    isCreating: isCreatingSession,
    errorMessage: newSessionError,
    onNameChange: setNewSessionName,
    onBack: () => terminalId && navigateTo(sessionsPath(terminalId)),
    onCreate: () => {
      const workspaceId = newSessionWorkspaceId || workspaces[0]?.id;
      if (!selectedTerminal || isCreatingSession || !workspaceId) return;
      setIsCreatingSession(true);
      setNewSessionError(null);
      void createSession({ name: newSessionName, workspaceId }, agentdConnection)
        .then((session) => {
          setCreatedSession(session);
          queryClient.setQueryData<TmuxSession[]>(["sessions", connectionKey, terminalId], (current) => [
            ...(current ?? []).filter((candidate) => candidate.name !== session.name),
            session,
          ]);
          if (terminalId) navigateTo(sessionPath(terminalId, session.name));
        })
        .catch((error: unknown) => setNewSessionError(errorMessage(error) ?? "Could not create tmux session"))
        .finally(() => setIsCreatingSession(false));
    },
  }), [agentdConnection, connectionKey, isCreatingSession, navigate, newSessionError, newSessionName, newSessionWorkspaceId, queryClient, selectedTerminal, terminalId, workspaceError, workspaceStatus, workspaces]);

  const newPane = useMemo<NewPaneViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    session: selectedSession ?? fallbackSession,
    name: newPaneName,
    workspacePicker: {
      workspaces,
      projects,
      workspaceId: newPaneWorkspaceId || workspaces[0]?.id || "",
      mode: newPaneSelectionMode,
      projectId: newPaneProjectId ?? projects[0]?.id ?? null,
      workspaceStatus,
      projectStatus,
      errorMessage: workspaceError ?? projectError,
      onWorkspaceChange: setNewPaneWorkspaceId,
      onModeChange: (mode) => {
        setNewPaneSelectionMode(mode);
        if (mode === "workspace") setNewPaneProjectId(null);
      },
      onProjectChange: setNewPaneProjectId,
    },
    kind: newPaneKind,
    agentId: newPaneAgent,
    existingPanes: sessionPanes,
    placement: newPanePlacement,
    targetPaneId: newPaneTargetPaneId,
    isCreating: isCreatingPane,
    errorMessage: newPaneError,
    onNameChange: setNewPaneName,
    onKindChange: (kind) => {
      setNewPaneKind(kind);
      if (kind === "shell") {
        setNewPaneSelectionMode("workspace");
        setNewPaneProjectId(null);
      }
    },
    onAgentChange: setNewPaneAgent,
    onPlacementChange: (placement) => {
      setNewPanePlacement(placement);
      if (placement !== "window" && !newPaneTargetPaneId) setNewPaneTargetPaneId(sessionPanes[0]?.tmuxPaneId ?? null);
    },
    onTargetPaneChange: setNewPaneTargetPaneId,
    onCreate: () => {
      const workspaceId = newPaneWorkspaceId || workspaces[0]?.id;
      const projectId = newPaneProjectId ?? projects[0]?.id ?? null;
      if (!selectedSession || !selectedTerminal || isCreatingPane || !workspaceId) return;
      setIsCreatingPane(true);
      setNewPaneError(null);
      void createPane({
        sessionName: selectedSession.name,
        kind: newPaneKind,
        name: newPaneName,
        workspaceId,
        agentId: newPaneKind === "agent" ? newPaneAgent : null,
        useWorktree: newPaneKind === "agent" && newPaneSelectionMode === "worktree",
        projectId: newPaneKind === "agent" && newPaneSelectionMode === "worktree" ? projectId : null,
        projectName: null,
        placement: newPanePlacement,
        targetPaneId: newPanePlacement === "window" ? null : newPaneTargetPaneId,
      }, agentdConnection)
        .then((pane) => {
          queryClient.setQueryData<PaneSummary[]>(paneQueryKey(agentdConnection, selectedSession.name), (current) => [
            ...(current ?? []).filter((candidate) => candidate.id !== pane.id),
            pane,
          ]);
          void queryClient.invalidateQueries({ queryKey: paneQueryKey(agentdConnection, selectedSession.name) });
          if (terminalId) navigateTo(panePath(terminalId, selectedSession.name, pane.id));
        })
        .catch((error: unknown) => setNewPaneError(errorMessage(error) ?? "Could not open pane"))
        .finally(() => setIsCreatingPane(false));
    },
    onBack: () => terminalId && selectedSession && navigateTo(sessionPath(terminalId, selectedSession.name)),
  }), [agentdConnection, connectionKey, isCreatingPane, navigate, newPaneAgent, newPaneError, newPaneKind, newPaneName, newPanePlacement, newPaneProjectId, newPaneSelectionMode, newPaneTargetPaneId, newPaneWorkspaceId, projectError, projectStatus, projects, queryClient, selectedSession, selectedTerminal, sessionPanes, terminalId, workspaceError, workspaceStatus, workspaces]);

  const sessionOverview = useMemo<SessionOverviewViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    session: selectedSession ?? fallbackSession,
    panes: sessionPanes,
    status: queryStatus(panesQuery.status),
    errorMessage: errorMessage(panesQuery.error),
    onSelectPane: (pane) => {
      if (terminalId && selectedSession) navigateTo(panePath(terminalId, selectedSession.name, pane.id));
    },
    onCreatePane: () => {
      setNewPaneError(null);
      setNewPaneName("");
      setNewPaneWorkspaceId("");
      setNewPaneKind("agent");
      setNewPaneAgent("codex");
      setNewPaneSelectionMode("workspace");
      setNewPaneProjectId(null);
      setNewPanePlacement("window");
      setNewPaneTargetPaneId(sessionPanes[0]?.tmuxPaneId ?? null);
      if (terminalId && selectedSession) navigateTo(newPanePath(terminalId, selectedSession.name));
    },
    onBack: () => terminalId && navigateTo(sessionsPath(terminalId)),
    onDisconnect: () => {
      if (terminalId && selectedSession) navigateTo(disconnectedPath(terminalId, selectedSession.name));
    },
  }), [navigate, panesQuery.error, panesQuery.status, selectedSession, selectedTerminal, sessionPanes, terminalId]);

  const connectionSettings = useMemo<ConnectionSettingsViewModel>(() => ({
    name: connectionName,
    serveUrl,
    hasSavedProfile: Boolean(connectionProfile),
    isSaving: isSavingConnection,
    errorMessage: connectionSettingsError,
    onNameChange: setConnectionName,
    onServeUrlChange: (value) => {
      setServeUrl(value);
      if (connectionSettingsError) setConnectionSettingsError(null);
    },
    onSave: () => {
      if (isSavingConnection) return;
      setIsSavingConnection(true);
      setConnectionSettingsError(null);
      try {
        const profile = saveBrowserConnectionProfile({ name: connectionName, serveUrl });
        setConnectionProfile(profile);
        setConnectionName(profile.name);
        setServeUrl(profile.serveUrl);
        navigateTo(terminalsPath());
      } catch (error) {
        setConnectionSettingsError(errorMessage(error) ?? "Invalid Serve URL");
      } finally {
        setIsSavingConnection(false);
      }
    },
    onClear: () => {
      clearBrowserConnectionProfile();
      setConnectionProfile(null);
      setConnectionName("");
      setServeUrl("");
      navigateTo(terminalsPath());
    },
    onBack: () => navigateTo(terminalsPath()),
  }), [connectionName, connectionProfile, connectionSettingsError, isSavingConnection, navigate, serveUrl]);

  return {
    stage,
    connection,
    connectionSettings,
    newSession,
    newPane,
    sessionOverview,
    terminalView,
    paneBoard,
    onWorkspaceSwitch: () => {
      if (terminalId) navigateTo(sessionsPath(terminalId));
    },
    onOpenNewPane: () => {
      if (!selectedSession || !selectedTerminal || !terminalId) return;
      setNewPaneError(null);
      setNewPaneName("");
      setNewPaneWorkspaceId("");
      setNewPaneKind("agent");
      setNewPaneAgent("codex");
      setNewPaneSelectionMode("workspace");
      setNewPaneProjectId(null);
      setNewPanePlacement(selectedPaneId ? "right" : "window");
      setNewPaneTargetPaneId(selectedPaneId ?? sessionPanes[0]?.tmuxPaneId ?? null);
      navigateTo(newPanePath(terminalId, selectedSession.name));
    },
  };
}

function isConnectionStage(stage: ProductStage): stage is ConnectionFlowStage {
  return stage === "terminals" || stage === "sessions" || stage === "connecting" || stage === "disconnected" || stage === "ended" || stage === "settings";
}

function queryStatus(status: "pending" | "error" | "success"): "loading" | "error" | "ready" {
  return status === "pending" ? "loading" : status === "error" ? "error" : "ready";
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? String(error) : null;
}

const fallbackTerminal: TerminalEndpoint = {
  id: "local",
  name: "local terminal",
  host: "localhost",
  tailnetIp: "localhost",
  state: "online",
  detail: "agentd",
  lastSeen: "unknown",
};

const fallbackSession: TmuxSession = {
  name: "session",
  project: "project",
  cwd: "~",
  paneCount: 0,
  waitingCount: 0,
  detail: "tmux",
  state: "idle",
};
