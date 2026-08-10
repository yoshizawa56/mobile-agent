import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PanePlacement, PaneSummary, TmuxSession } from "@mobile-agent/protocol";
import { fetchPanes, fetchSessions, fetchTerminals, createPane, createSession, getAgentdConnection } from "../api/agentd-api";
import type { ConnectionFlowStage, ConnectionFlowViewModel, TerminalEndpoint } from "../connection/connection-flow-viewmodel";
import type { ConnectionSettingsViewModel } from "../connection/connection-settings-view";
import {
  clearBrowserConnectionProfile,
  connectionForProfile,
  readBrowserConnectionProfile,
  saveBrowserConnectionProfile,
  type BrowserConnectionProfile,
} from "../connection/connection-profile-store";
import type { NewSessionViewModel } from "../session/new-session-view";
import type { SessionOverviewViewModel } from "../session/session-overview-viewmodel";
import type { NewPaneAgent, NewPaneKind, NewPaneViewModel } from "../pane/new-pane-view";
import { paneQueryKey, usePaneBoardViewModel } from "../pane-board/pane-board-viewmodel";
import { usePaneViewModel } from "../pane/pane-viewmodel";

export type ProductStage = ConnectionFlowStage | "new-session" | "new-pane" | "session-overview" | "control-room";

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
  const [stage, setStage] = useState<ProductStage>("terminals");
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [createdSession, setCreatedSession] = useState<TmuxSession | null>(null);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionCwd, setNewSessionCwd] = useState("~");
  const [newSessionError, setNewSessionError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newPaneName, setNewPaneName] = useState("");
  const [newPaneCwd, setNewPaneCwd] = useState("~");
  const [newPaneKind, setNewPaneKind] = useState<NewPaneKind>("agent");
  const [newPaneAgent, setNewPaneAgent] = useState<NewPaneAgent>("codex");
  const [newPaneUseWorktree, setNewPaneUseWorktree] = useState(false);
  const [newPaneProjectName, setNewPaneProjectName] = useState("");
  const [newPanePlacement, setNewPanePlacement] = useState<PanePlacement>("window");
  const [newPaneTargetPaneId, setNewPaneTargetPaneId] = useState<string | null>(null);
  const [newPaneError, setNewPaneError] = useState<string | null>(null);
  const [isCreatingPane, setIsCreatingPane] = useState(false);
  const [connectionProfile, setConnectionProfile] = useState<BrowserConnectionProfile | null>(() => readBrowserConnectionProfile());
  const [connectionName, setConnectionName] = useState(() => readBrowserConnectionProfile()?.name ?? "");
  const [serveUrl, setServeUrl] = useState(() => readBrowserConnectionProfile()?.serveUrl ?? "");
  const [connectionSettingsError, setConnectionSettingsError] = useState<string | null>(null);
  const [isSavingConnection, setIsSavingConnection] = useState(false);

  const agentdConnection = useMemo(
    () => connectionForProfile(connectionProfile) ?? getAgentdConnection(),
    [connectionProfile],
  );
  const connectionKey = `${agentdConnection.route ?? "custom"}:${agentdConnection.httpBaseUrl}`;

  const terminalsQuery = useQuery({
    queryKey: ["terminals", connectionKey],
    queryFn: () => fetchTerminals(agentdConnection),
    staleTime: 5_000,
    retry: 1,
  });
  const terminals = terminalsQuery.data ?? [];
  const selectedTerminal = terminals.find((terminal) => terminal.id === terminalId) ?? null;

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
    enabled: Boolean(selectedSession?.name) && (stage === "session-overview" || stage === "control-room"),
    staleTime: 1_000,
    refetchInterval: stage === "session-overview" ? 3_000 : false,
    retry: 1,
  });
  const sessionPanes = panesQuery.data ?? [];
  const paneTarget = selectedPaneId ?? sessionPanes[0]?.tmuxPaneId ?? "";
  const terminalView = usePaneViewModel({ target: paneTarget, active: stage === "control-room", connection: agentdConnection });

  const paneBoard = usePaneBoardViewModel({
    selectedTarget: selectedPaneId ?? "",
    sessionName: selectedSession?.name,
    connection: agentdConnection,
    alwaysOpen: stage === "control-room",
    onSelect: (target) => {
      setSelectedPaneId(target);
      setStage("control-room");
    },
  });

  useEffect(() => {
    if (stage !== "connecting") return;
    const timer = window.setTimeout(() => {
      setSelectedPaneId(null);
      setStage("session-overview");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [stage]);

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
      setTerminalId(terminal.id);
      setSessionName(null);
      setSelectedPaneId(null);
      setCreatedSession(null);
      setStage("sessions");
    },
    onSelectSession: (session) => {
      setSessionName(session.name);
      setSelectedPaneId(null);
      setStage("connecting");
    },
    onCreateSession: () => {
      setNewSessionError(null);
      setNewSessionName("");
      setNewSessionCwd(selectedTerminal?.name ? "~" : "");
      setStage("new-session");
    },
    onBack: () => setStage(stage === "connecting" ? "sessions" : "terminals"),
    onOpenSessionOverview: () => {
      setSelectedPaneId(null);
      setStage("session-overview");
    },
    onDisconnect: () => setStage("disconnected"),
    onReconnect: () => setStage("connecting"),
    onChooseTerminal: () => {
      setTerminalId(null);
      setSessionName(null);
      setSelectedPaneId(null);
      setStage("terminals");
    },
    onOpenSettings: () => {
      setConnectionSettingsError(null);
      setStage("settings");
    },
  }), [selectedSession, selectedTerminal, sessions, sessionsQuery.error, sessionsQuery.status, stage, terminals, terminalsQuery.error, terminalsQuery.status]);

  const newSession = useMemo<NewSessionViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    name: newSessionName,
    cwd: newSessionCwd,
    isCreating: isCreatingSession,
    errorMessage: newSessionError,
    onNameChange: setNewSessionName,
    onCwdChange: setNewSessionCwd,
    onBack: () => setStage("sessions"),
    onCreate: () => {
      if (!selectedTerminal || isCreatingSession) return;
      setIsCreatingSession(true);
      setNewSessionError(null);
      void createSession({ name: newSessionName, cwd: newSessionCwd }, agentdConnection)
        .then((session) => {
          setCreatedSession(session);
          setSessionName(session.name);
          setSelectedPaneId(null);
          queryClient.setQueryData<TmuxSession[]>(["sessions", connectionKey, terminalId], (current) => [
            ...(current ?? []).filter((candidate) => candidate.name !== session.name),
            session,
          ]);
          setStage("session-overview");
        })
        .catch((error: unknown) => setNewSessionError(errorMessage(error) ?? "Could not create tmux session"))
        .finally(() => setIsCreatingSession(false));
    },
  }), [connectionKey, isCreatingSession, newSessionCwd, newSessionError, newSessionName, queryClient, selectedTerminal, terminalId, agentdConnection]);

  const newPane = useMemo<NewPaneViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    session: selectedSession ?? fallbackSession,
    name: newPaneName,
    cwd: newPaneCwd,
    kind: newPaneKind,
    agentId: newPaneAgent,
    useWorktree: newPaneUseWorktree,
    projectName: newPaneProjectName,
    existingPanes: sessionPanes,
    placement: newPanePlacement,
    targetPaneId: newPaneTargetPaneId,
    isCreating: isCreatingPane,
    errorMessage: newPaneError,
    onNameChange: setNewPaneName,
    onCwdChange: setNewPaneCwd,
    onKindChange: (kind) => {
      setNewPaneKind(kind);
      if (kind === "shell") setNewPaneUseWorktree(false);
    },
    onAgentChange: setNewPaneAgent,
    onUseWorktreeChange: setNewPaneUseWorktree,
    onProjectNameChange: setNewPaneProjectName,
    onPlacementChange: (placement) => {
      setNewPanePlacement(placement);
      if (placement !== "window" && !newPaneTargetPaneId) setNewPaneTargetPaneId(sessionPanes[0]?.tmuxPaneId ?? null);
    },
    onTargetPaneChange: setNewPaneTargetPaneId,
    onCreate: () => {
      if (!selectedSession || !selectedTerminal || isCreatingPane) return;
      setIsCreatingPane(true);
      setNewPaneError(null);
      void createPane({
        sessionName: selectedSession.name,
        kind: newPaneKind,
        name: newPaneName,
        cwd: newPaneCwd,
        agentId: newPaneKind === "agent" ? newPaneAgent : null,
        useWorktree: newPaneKind === "agent" && newPaneUseWorktree,
        projectName: newPaneKind === "agent" && newPaneUseWorktree ? (newPaneProjectName || null) : null,
        placement: newPanePlacement,
        targetPaneId: newPanePlacement === "window" ? null : newPaneTargetPaneId,
      }, agentdConnection)
        .then((pane) => {
          queryClient.setQueryData<PaneSummary[]>(paneQueryKey(agentdConnection, selectedSession.name), (current) => [
            ...(current ?? []).filter((candidate) => candidate.id !== pane.id),
            pane,
          ]);
          void queryClient.invalidateQueries({ queryKey: paneQueryKey(agentdConnection, selectedSession.name) });
          setSelectedPaneId(pane.tmuxPaneId);
          setStage("control-room");
        })
        .catch((error: unknown) => setNewPaneError(errorMessage(error) ?? "Could not open pane"))
        .finally(() => setIsCreatingPane(false));
    },
    onBack: () => setStage("session-overview"),
  }), [agentdConnection, connectionKey, isCreatingPane, newPaneAgent, newPaneCwd, newPaneError, newPaneKind, newPaneName, newPanePlacement, newPaneProjectName, newPaneTargetPaneId, newPaneUseWorktree, queryClient, selectedSession, selectedTerminal, sessionPanes]);

  const sessionOverview = useMemo<SessionOverviewViewModel>(() => ({
    terminal: selectedTerminal ?? fallbackTerminal,
    session: selectedSession ?? fallbackSession,
    panes: sessionPanes,
    status: queryStatus(panesQuery.status),
    errorMessage: errorMessage(panesQuery.error),
    onSelectPane: (pane) => {
      setSelectedPaneId(pane.tmuxPaneId);
      setStage("control-room");
    },
    onCreatePane: () => {
      setNewPaneError(null);
      setNewPaneName("");
      setNewPaneCwd(sessionPanes[0]?.cwd ?? "~");
      setNewPaneKind("agent");
      setNewPaneAgent("codex");
      setNewPaneUseWorktree(false);
      setNewPaneProjectName(selectedSession?.project ?? "");
      setNewPanePlacement("window");
      setNewPaneTargetPaneId(sessionPanes[0]?.tmuxPaneId ?? null);
      setStage("new-pane");
    },
    onBack: () => setStage("sessions"),
    onDisconnect: () => setStage("disconnected"),
  }), [panesQuery.error, panesQuery.status, selectedSession, selectedTerminal, sessionPanes]);

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
        setStage("terminals");
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
      setStage("terminals");
    },
    onBack: () => setStage("terminals"),
  }), [connectionName, connectionProfile, connectionSettingsError, isSavingConnection, serveUrl]);

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
      setSelectedPaneId(null);
      setStage("sessions");
    },
    onOpenNewPane: () => {
      if (!selectedSession || !selectedTerminal) return;
      setNewPaneError(null);
      setNewPaneName("");
      setNewPaneCwd(sessionPanes.find((pane) => pane.tmuxPaneId === selectedPaneId)?.cwd ?? sessionPanes[0]?.cwd ?? "~");
      setNewPaneKind("agent");
      setNewPaneAgent("codex");
      setNewPaneUseWorktree(false);
      setNewPaneProjectName(selectedSession.project ?? "");
      setNewPanePlacement(selectedPaneId ? "right" : "window");
      setNewPaneTargetPaneId(selectedPaneId ?? sessionPanes[0]?.tmuxPaneId ?? null);
      setStage("new-pane");
    },
  };
}

function isConnectionStage(stage: ProductStage): stage is ConnectionFlowStage {
  return stage !== "new-session" && stage !== "session-overview" && stage !== "control-room";
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
