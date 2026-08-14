import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { PanePlacement, PaneSummary, TmuxSession, WorkspaceDirectory } from "@mobile-agent/protocol";
import { fetchPanes, fetchSessions, fetchTerminals, fetchWorkspaceDirectories, fetchWorkspaces, createPane, createSession, getAgentdConnection, registerWorkspace } from "../api/agentd-api";
import type { ConnectionFlowStage, ConnectionFlowViewModel, TerminalEndpoint } from "../connection/connection-flow-viewmodel";
import type { ConnectionSettingsViewModel } from "../connection/connection-settings-viewmodel";
import { pairBrowserFromQr } from "../connection/browser-auth";
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
  const [newPaneSelectionMode, setNewPaneSelectionMode] = useState<WorkspaceSelectionMode>("worktree");
  const [newPanePlacement, setNewPanePlacement] = useState<PanePlacement>("window");
  const [newPaneTargetPaneId, setNewPaneTargetPaneId] = useState<string | null>(null);
  const [newPaneError, setNewPaneError] = useState<string | null>(null);
  const [isCreatingPane, setIsCreatingPane] = useState(false);
  const [workspaceCandidates, setWorkspaceCandidates] = useState<WorkspaceDirectory[]>([]);
  const [workspaceBrowserPath, setWorkspaceBrowserPath] = useState<string | null>(null);
  const [workspaceBrowserStatus, setWorkspaceBrowserStatus] = useState<"loading" | "ready" | "error">("ready");
  const [workspaceBrowserError, setWorkspaceBrowserError] = useState<string | null>(null);
  const [workspaceRegistrationOpen, setWorkspaceRegistrationOpen] = useState(false);
  const [workspaceRegistrationDirectory, setWorkspaceRegistrationDirectory] = useState("");
  const [workspaceSetupScriptPath, setWorkspaceSetupScriptPath] = useState("");
  const [workspaceCleanupScriptPath, setWorkspaceCleanupScriptPath] = useState("");
  const [workspaceWorktreeCopyPatterns, setWorkspaceWorktreeCopyPatterns] = useState("");
  const [isRegisteringWorkspace, setIsRegisteringWorkspace] = useState(false);
  const [workspaceRegistrationError, setWorkspaceRegistrationError] = useState<string | null>(null);
  const [connectionProfile, setConnectionProfile] = useState<BrowserConnectionProfile | null>(() => readBrowserConnectionProfile());
  const [connectionName, setConnectionName] = useState(() => readBrowserConnectionProfile()?.name ?? "");
  const [serveUrl, setServeUrl] = useState(() => readBrowserConnectionProfile()?.serveUrl ?? "");
  const [connectionSettingsError, setConnectionSettingsError] = useState<string | null>(null);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [isPairingQr, setIsPairingQr] = useState(false);
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);

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
  const workspaces = workspacesQuery.data ?? [];
  const workspaceStatus = queryStatus(workspacesQuery.status);
  const workspaceError = errorMessage(workspacesQuery.error);

  useEffect(() => {
    if (stage !== "new-pane" || newPaneKind !== "agent" || newPaneSelectionMode !== "worktree") return;
    const selectedWorkspace = workspaces.find((workspace) => workspace.id === newPaneWorkspaceId) ?? workspaces[0];
    if (selectedWorkspace && !selectedWorkspace.isGit) setNewPaneSelectionMode("workspace");
  }, [newPaneKind, newPaneSelectionMode, newPaneWorkspaceId, stage, workspaces]);

  const browseWorkspaceDirectories = useCallback((path?: string) => {
    setWorkspaceBrowserStatus("loading");
    setWorkspaceBrowserError(null);
    void fetchWorkspaceDirectories(path, agentdConnection)
      .then((directories) => {
        setWorkspaceCandidates(directories);
        setWorkspaceBrowserPath(path ?? null);
        setWorkspaceBrowserStatus("ready");
      })
      .catch((error: unknown) => {
        setWorkspaceBrowserError(errorMessage(error) ?? "Could not browse host directories");
        setWorkspaceBrowserStatus("error");
      });
  }, [agentdConnection]);

  const openWorkspaceRegistration = useCallback(() => {
    setWorkspaceRegistrationOpen(true);
    setWorkspaceRegistrationError(null);
    if (workspaceBrowserStatus !== "ready" || !workspaceCandidates.length) browseWorkspaceDirectories();
  }, [browseWorkspaceDirectories, workspaceBrowserStatus, workspaceCandidates.length]);

  const registerNewWorkspace = useCallback(() => {
    const directory = workspaceRegistrationDirectory.trim();
    if (!directory || isRegisteringWorkspace) return;
    setIsRegisteringWorkspace(true);
    setWorkspaceRegistrationError(null);
    void registerWorkspace({
      directory,
      setupScriptPath: workspaceSetupScriptPath.trim() || null,
      cleanupScriptPath: workspaceCleanupScriptPath.trim() || null,
      worktreeCopyPatterns: parseWorktreeCopyPatterns(workspaceWorktreeCopyPatterns),
    }, agentdConnection)
      .then((workspace) => {
        queryClient.setQueryData<WorkspaceDirectory[]>(["workspaces", connectionKey], (current) => {
          const next = [...(current ?? []).filter((candidate) => candidate.id !== workspace.id), workspace];
          return next.sort((left, right) => left.name.localeCompare(right.name));
        });
        setNewSessionWorkspaceId(workspace.id);
        setNewPaneWorkspaceId(workspace.id);
        setWorkspaceRegistrationOpen(false);
        setWorkspaceRegistrationError(null);
      })
      .catch((error: unknown) => setWorkspaceRegistrationError(errorMessage(error) ?? "Could not register workspace"))
      .finally(() => setIsRegisteringWorkspace(false));
  }, [agentdConnection, connectionKey, isRegisteringWorkspace, queryClient, workspaceCleanupScriptPath, workspaceRegistrationDirectory, workspaceSetupScriptPath, workspaceWorktreeCopyPatterns]);

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
      workspaceCandidates,
      workspaceId: newSessionWorkspaceId || workspaces[0]?.id || "",
      mode: "workspace",
      workspaceStatus,
      browserStatus: workspaceBrowserStatus,
      browserPath: workspaceBrowserPath,
      registrationOpen: workspaceRegistrationOpen,
      registrationDirectory: workspaceRegistrationDirectory,
      setupScriptPath: workspaceSetupScriptPath,
      cleanupScriptPath: workspaceCleanupScriptPath,
      worktreeCopyPatterns: workspaceWorktreeCopyPatterns,
      isRegisteringWorkspace,
      registrationError: workspaceRegistrationError,
      errorMessage: workspaceError ?? workspaceBrowserError,
      onWorkspaceChange: setNewSessionWorkspaceId,
      onModeChange: () => undefined,
      onOpenRegistration: openWorkspaceRegistration,
      onCloseRegistration: () => setWorkspaceRegistrationOpen(false),
      onBrowseWorkspace: browseWorkspaceDirectories,
      onSelectWorkspaceDirectory: setWorkspaceRegistrationDirectory,
      onRegistrationDirectoryChange: setWorkspaceRegistrationDirectory,
      onSetupScriptPathChange: setWorkspaceSetupScriptPath,
      onCleanupScriptPathChange: setWorkspaceCleanupScriptPath,
      onWorktreeCopyPatternsChange: setWorkspaceWorktreeCopyPatterns,
      onRegisterWorkspace: registerNewWorkspace,
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
  }), [agentdConnection, browseWorkspaceDirectories, connectionKey, isCreatingSession, isRegisteringWorkspace, navigate, newSessionError, newSessionName, newSessionWorkspaceId, openWorkspaceRegistration, queryClient, registerNewWorkspace, selectedTerminal, terminalId, workspaceBrowserError, workspaceBrowserPath, workspaceBrowserStatus, workspaceCandidates, workspaceCleanupScriptPath, workspaceError, workspaceRegistrationDirectory, workspaceRegistrationError, workspaceRegistrationOpen, workspaceSetupScriptPath, workspaceStatus, workspaceWorktreeCopyPatterns, workspaces]);

  const newPane = useMemo<NewPaneViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    session: selectedSession ?? fallbackSession,
    name: newPaneName,
    workspacePicker: {
      workspaces,
      workspaceCandidates,
      workspaceId: newPaneWorkspaceId || workspaces[0]?.id || "",
      mode: newPaneSelectionMode,
      workspaceStatus,
      browserStatus: workspaceBrowserStatus,
      browserPath: workspaceBrowserPath,
      registrationOpen: workspaceRegistrationOpen,
      registrationDirectory: workspaceRegistrationDirectory,
      setupScriptPath: workspaceSetupScriptPath,
      cleanupScriptPath: workspaceCleanupScriptPath,
      worktreeCopyPatterns: workspaceWorktreeCopyPatterns,
      isRegisteringWorkspace,
      registrationError: workspaceRegistrationError,
      errorMessage: workspaceError ?? workspaceBrowserError,
      onWorkspaceChange: setNewPaneWorkspaceId,
      onModeChange: (mode) => {
        setNewPaneSelectionMode(mode);
      },
      onOpenRegistration: openWorkspaceRegistration,
      onCloseRegistration: () => setWorkspaceRegistrationOpen(false),
      onBrowseWorkspace: browseWorkspaceDirectories,
      onSelectWorkspaceDirectory: setWorkspaceRegistrationDirectory,
      onRegistrationDirectoryChange: setWorkspaceRegistrationDirectory,
      onSetupScriptPathChange: setWorkspaceSetupScriptPath,
      onCleanupScriptPathChange: setWorkspaceCleanupScriptPath,
      onWorktreeCopyPatternsChange: setWorkspaceWorktreeCopyPatterns,
      onRegisterWorkspace: registerNewWorkspace,
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
      } else {
        const selectedWorkspace = workspaces.find((workspace) => workspace.id === newPaneWorkspaceId) ?? workspaces[0];
        if (selectedWorkspace?.isGit) setNewPaneSelectionMode("worktree");
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
  }), [agentdConnection, browseWorkspaceDirectories, connectionKey, isCreatingPane, isRegisteringWorkspace, navigate, newPaneAgent, newPaneError, newPaneKind, newPaneName, newPanePlacement, newPaneSelectionMode, newPaneTargetPaneId, newPaneWorkspaceId, openWorkspaceRegistration, queryClient, registerNewWorkspace, selectedSession, selectedTerminal, sessionPanes, terminalId, workspaceBrowserError, workspaceBrowserPath, workspaceBrowserStatus, workspaceCandidates, workspaceCleanupScriptPath, workspaceError, workspaceRegistrationDirectory, workspaceRegistrationError, workspaceRegistrationOpen, workspaceSetupScriptPath, workspaceStatus, workspaceWorktreeCopyPatterns, workspaces]);

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
      setNewPaneSelectionMode("worktree");
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
    isScanningQr,
    isPairingQr,
    pairingMessage,
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
    onOpenQrScanner: () => {
      setConnectionSettingsError(null);
      setPairingMessage(null);
      setIsScanningQr(true);
    },
    onCloseQrScanner: () => setIsScanningQr(false),
    onQrValue: (value) => {
      if (isPairingQr) return;
      setIsScanningQr(false);
      setIsPairingQr(true);
      setPairingMessage("QRを確認しています…");
      setConnectionSettingsError(null);
      void pairBrowserFromQr(value, {
        deviceName: connectionName,
        onProgress: (progress) => {
          if (progress.phase === "claiming") setPairingMessage("端末を登録する準備をしています…");
          else if (progress.phase === "awaiting_approval") setPairingMessage("agentd側の承認を待っています…");
          else setPairingMessage("登録しました。接続しています…");
        },
      })
        .then((result) => {
          const profile = saveBrowserConnectionProfile({
            name: connectionName || result.deviceName,
            serveUrl: result.payload.agentdBaseUrl,
            serverId: result.serverId,
          });
          setConnectionProfile(profile);
          setConnectionName(profile.name);
          setServeUrl(profile.serveUrl);
          navigateTo(terminalsPath());
        })
        .catch((error: unknown) => {
          setConnectionSettingsError(errorMessage(error) ?? "QR pairing failed");
        })
        .finally(() => {
          setIsPairingQr(false);
          setPairingMessage(null);
        });
    },
    onBack: () => navigateTo(terminalsPath()),
  }), [connectionName, connectionProfile, connectionSettingsError, isPairingQr, isSavingConnection, isScanningQr, navigate, pairingMessage, serveUrl]);

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
      setNewPaneSelectionMode("worktree");
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

function parseWorktreeCopyPatterns(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((pattern) => pattern.trim()).filter(Boolean))];
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
  workspace: "workspace",
  cwd: "~",
  paneCount: 0,
  waitingCount: 0,
  detail: "tmux",
  state: "idle",
};
