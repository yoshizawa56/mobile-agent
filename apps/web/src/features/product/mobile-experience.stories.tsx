import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useState } from "react";
import type { PanePlacement, PaneSummary, WorkspaceDirectory } from "@mobile-agent/protocol";
import { ConnectionSettingsView } from "../connection/connection-settings-view";
import type { ConnectionSettingsViewModel } from "../connection/connection-settings-viewmodel";
import { mockSessions, mockTerminals } from "../connection/connection-flow-mock-data";
import type { ConnectionFlowStage, ConnectionFlowViewModel, TmuxSession } from "../connection/connection-flow-viewmodel";
import { NewSessionView } from "../session/new-session-view";
import type { NewSessionViewModel } from "../session/new-session-viewmodel";
import { SessionOverviewView } from "../session/session-overview-view";
import type { SessionOverviewViewModel } from "../session/session-overview-viewmodel";
import { PaneView } from "../pane/pane-view";
import { NewPaneView } from "../pane/new-pane-view";
import type { NewPaneAgent, NewPaneKind } from "../pane/new-pane-viewmodel";
import { usePaneViewModel } from "../pane/pane-viewmodel";
import type { PaneBoardViewModel } from "../pane-board/pane-board-viewmodel";
import { mockPanes } from "../../mock/mock-data";
import { TerminalsView } from "../../routes/terminals/-terminals-view";
import type { TerminalsViewModel } from "../../routes/terminals/-terminals-viewmodel";
import { SessionsView } from "../../routes/terminals/$terminalId/sessions/-sessions-view";
import type { SessionsViewModel } from "../../routes/terminals/$terminalId/sessions/-sessions-viewmodel";
import { ConnectingView } from "../../routes/terminals/$terminalId/sessions/$sessionName/connecting/-connecting-view";
import type { ConnectingViewModel } from "../../routes/terminals/$terminalId/sessions/$sessionName/connecting/-connecting-viewmodel";
import { DisconnectedView } from "../../routes/terminals/$terminalId/sessions/$sessionName/disconnected/-disconnected-view";
import type { DisconnectedViewModel } from "../../routes/terminals/$terminalId/sessions/$sessionName/disconnected/-disconnected-viewmodel";
import { EndedView } from "../../routes/terminals/$terminalId/sessions/$sessionName/ended/-ended-view";
import type { EndedViewModel } from "../../routes/terminals/$terminalId/sessions/$sessionName/ended/-ended-viewmodel";
import type { WorkspacePickerStatus, WorkspaceSelectionMode } from "../workspace/workspace-picker-viewmodel";

type ProductStage = ConnectionFlowStage | "new-session" | "new-pane" | "session-overview" | "control-room";
type WorkspaceStoryState = "ready" | "loading" | "error" | "empty";

function MobileExperience({ initialStage = "terminals", initialTerminalId = null, initialSessionName = null, initialPaneId = null, initialMapOpen = false, initialNewSession = false, initialWorkspaceState = "ready", initialSelectionMode = "worktree", autoAdvance = true }: { initialStage?: ProductStage; initialTerminalId?: string | null; initialSessionName?: string | null; initialPaneId?: string | null; initialMapOpen?: boolean; initialNewSession?: boolean; initialWorkspaceState?: WorkspaceStoryState; initialSelectionMode?: WorkspaceSelectionMode; autoAdvance?: boolean }) {
  const [stage, setStage] = useState<ProductStage>(initialNewSession ? "new-session" : initialStage);
  const [terminalId, setTerminalId] = useState<string | null>(initialTerminalId);
  const [sessionName, setSessionName] = useState<string | null>(initialSessionName);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(initialPaneId);
  const [mapOpen, setMapOpen] = useState(initialMapOpen);
  const [connectionStep, setConnectionStep] = useState(initialStage === "connecting" ? 2 : 0);
  const [newSession, setNewSession] = useState<TmuxSession | null>(null);
  const [newSessionName, setNewSessionName] = useState("design-lab");
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState("workspace-mobile-agent");
  const [newPaneName, setNewPaneName] = useState("review");
  const [newPaneWorkspaceId, setNewPaneWorkspaceId] = useState("workspace-mobile-agent");
  const [newPaneKind, setNewPaneKind] = useState<NewPaneKind>("agent");
  const [newPaneAgent, setNewPaneAgent] = useState<NewPaneAgent>("codex");
  const [newPaneSelectionMode, setNewPaneSelectionMode] = useState<WorkspaceSelectionMode>(initialSelectionMode);
  const [newPanePlacement, setNewPanePlacement] = useState<PanePlacement>("right");
  const [newPaneTargetPaneId, setNewPaneTargetPaneId] = useState<string | null>("%0");

  const storyWorkspaces: WorkspaceDirectory[] = initialWorkspaceState === "empty" ? [] : [{
    id: "workspace-mobile-agent",
    name: "mobile-agent",
    directory: "~/work/mobile-agent",
    isGit: true,
    setupScriptPath: "~/.config/agent/setup",
    cleanupScriptPath: "~/.config/agent/cleanup",
    worktreeCopyPatterns: [".env", ".env.local"],
  }, {
    id: "workspace-scratch",
    name: "scratch",
    directory: "~/tmp/scratch",
    isGit: false,
    setupScriptPath: null,
    cleanupScriptPath: null,
    worktreeCopyPatterns: [],
  }];
  const pickerStatus: WorkspacePickerStatus = initialWorkspaceState === "loading" ? "loading" : initialWorkspaceState === "error" ? "error" : "ready";

  const selectedTerminal = mockTerminals.find((terminal) => terminal.id === terminalId) ?? mockTerminals[0];
  const selectedSession = newSession?.name === sessionName ? newSession : mockSessions.find((session) => session.name === sessionName) ?? null;
  const panes = useMemo(() => {
    if (!newSession) return mockPanes;
    const shell = mockPanes.find((pane) => pane.kind === "shell") ?? mockPanes[0];
    return [...mockPanes, {
      ...shell,
      id: "pane-new-session-shell",
      tmuxPaneId: "%4",
      sessionName: newSession.name,
      windowId: "@4",
      name: `${newSession.name} shell`,
      cwd: storyWorkspaces.find((workspace) => workspace.id === newSessionWorkspaceId)?.directory ?? "/tmp",
      state: "running" as const,
      title: "zsh",
    }];
  }, [newSession, newSessionWorkspaceId]);
  const sessionPanes = selectedSession ? panes.filter((pane) => pane.sessionName === selectedSession.name) : [];
  const paneTarget = selectedPaneId ?? sessionPanes[0]?.tmuxPaneId ?? "%0";
  const terminalViewModel = usePaneViewModel({ target: paneTarget });

  const connectionSettingsViewModel = useMemo<ConnectionSettingsViewModel>(() => ({
    hasSavedProfile: true,
    isScanningQr: false,
    isPairingQr: false,
    pairingMessage: null,
    errorMessage: null,
    onClear: () => setStage("terminals"),
    onBack: () => setStage("terminals"),
    onOpenQrScanner: () => undefined,
    onCloseQrScanner: () => undefined,
    onQrValue: () => undefined,
  }), []);

  useEffect(() => {
    if (!autoAdvance || stage !== "connecting") return;
    const timer = window.setTimeout(() => {
      setSelectedPaneId(null);
      setMapOpen(false);
      setStage("session-overview");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, stage]);

  const connectionViewModel = useMemo<ConnectionFlowViewModel>(() => ({
    stage: isConnectionStage(stage) ? stage : "terminals",
    terminals: mockTerminals,
    sessions: newSession ? [...mockSessions, newSession] : mockSessions,
    selectedTerminal: terminalId ? selectedTerminal : null,
    selectedSession,
    connectionStep,
    onSelectTerminal: (terminal) => {
      setTerminalId(terminal.id);
      setSessionName(null);
      setSelectedPaneId(null);
      setStage("sessions");
    },
    onSelectSession: (session) => {
      setSessionName(session.name);
      setSelectedPaneId(null);
      setConnectionStep(1);
      setStage("connecting");
    },
    onCreateSession: () => {
      setStage("new-session");
    },
    onBack: () => setStage(stage === "connecting" ? "sessions" : "terminals"),
    onOpenSessionOverview: () => {
      setSelectedPaneId(null);
      setMapOpen(false);
      setStage("session-overview");
    },
    onDisconnect: () => setStage("disconnected"),
    onReconnect: () => {
      setConnectionStep(2);
      setStage("connecting");
    },
    onChooseTerminal: () => {
      setTerminalId(null);
      setSessionName(null);
      setSelectedPaneId(null);
      setStage("terminals");
    },
    onOpenSettings: () => setStage("settings"),
  }), [connectionStep, newSession, selectedSession, selectedTerminal, stage, terminalId]);

  const sessionOverviewViewModel = useMemo<SessionOverviewViewModel>(() => ({
    terminal: selectedTerminal,
    session: selectedSession ?? mockSessions[0],
    panes: sessionPanes,
    onSelectPane: (pane) => {
      setSelectedPaneId(pane.tmuxPaneId);
      setMapOpen(false);
      setStage("control-room");
    },
    onCreatePane: () => setStage("new-pane"),
    onBack: () => setStage("sessions"),
    onDisconnect: () => setStage("disconnected"),
  }), [selectedSession, selectedTerminal, sessionPanes]);

  const newPaneViewModel = useMemo(() => ({
    terminal: selectedTerminal,
    session: selectedSession ?? mockSessions[0],
    name: newPaneName,
    workspacePicker: {
      workspaces: storyWorkspaces,
      workspaceCandidates: storyWorkspaces,
      workspaceId: newPaneWorkspaceId,
      mode: newPaneSelectionMode,
      workspaceStatus: pickerStatus,
      browserStatus: pickerStatus,
      browserPath: null,
      registrationOpen: false,
      registrationDirectory: "",
      setupScriptPath: "",
      cleanupScriptPath: "",
      worktreeCopyPatterns: "",
      isRegisteringWorkspace: false,
      registrationError: null,
      errorMessage: initialWorkspaceState === "error" ? "Workspace directory service is unavailable" : null,
      onWorkspaceChange: setNewPaneWorkspaceId,
      onModeChange: (mode: WorkspaceSelectionMode) => {
        setNewPaneSelectionMode(mode);
      },
      onOpenRegistration: () => undefined,
      onCloseRegistration: () => undefined,
      onBrowseWorkspace: () => undefined,
      onSelectWorkspaceDirectory: () => undefined,
      onRegistrationDirectoryChange: () => undefined,
      onSetupScriptPathChange: () => undefined,
      onCleanupScriptPathChange: () => undefined,
      onWorktreeCopyPatternsChange: () => undefined,
      onRegisterWorkspace: () => undefined,
    },
    kind: newPaneKind,
    agentId: newPaneAgent,
    existingPanes: sessionPanes,
    placement: newPanePlacement,
    targetPaneId: newPaneTargetPaneId,
    isCreating: false,
    errorMessage: null,
    onNameChange: setNewPaneName,
    onKindChange: (kind: NewPaneKind) => {
      setNewPaneKind(kind);
      if (kind === "shell") setNewPaneSelectionMode("workspace");
    },
    onAgentChange: setNewPaneAgent,
    onPlacementChange: setNewPanePlacement,
    onTargetPaneChange: setNewPaneTargetPaneId,
    onCreate: () => setStage("session-overview"),
    onBack: () => setStage("session-overview"),
  }), [initialWorkspaceState, newPaneAgent, newPaneKind, newPaneName, newPanePlacement, newPaneSelectionMode, newPaneTargetPaneId, newPaneWorkspaceId, pickerStatus, selectedSession, selectedTerminal, sessionPanes, storyWorkspaces]);

  const newSessionViewModel = useMemo<NewSessionViewModel>(() => ({
    terminal: selectedTerminal,
    name: newSessionName,
    workspacePicker: {
      workspaces: storyWorkspaces,
      workspaceCandidates: storyWorkspaces,
      workspaceId: newSessionWorkspaceId,
      mode: "workspace",
      workspaceStatus: pickerStatus,
      browserStatus: pickerStatus,
      browserPath: null,
      registrationOpen: false,
      registrationDirectory: "",
      setupScriptPath: "",
      cleanupScriptPath: "",
      worktreeCopyPatterns: "",
      isRegisteringWorkspace: false,
      registrationError: null,
      errorMessage: initialWorkspaceState === "error" ? "Workspace directory service is unavailable" : null,
      onWorkspaceChange: setNewSessionWorkspaceId,
      onModeChange: () => undefined,
      onOpenRegistration: () => undefined,
      onCloseRegistration: () => undefined,
      onBrowseWorkspace: () => undefined,
      onSelectWorkspaceDirectory: () => undefined,
      onRegistrationDirectoryChange: () => undefined,
      onSetupScriptPathChange: () => undefined,
      onCleanupScriptPathChange: () => undefined,
      onWorktreeCopyPatternsChange: () => undefined,
      onRegisterWorkspace: () => undefined,
    },
    onNameChange: setNewSessionName,
    onBack: () => setStage("sessions"),
    onCreate: () => {
      const workspace = storyWorkspaces.find((candidate) => candidate.id === newSessionWorkspaceId) ?? storyWorkspaces[0];
      if (!workspace) return;
      const created: TmuxSession = {
        name: newSessionName.trim(),
        paneCount: 1,
        waitingCount: 0,
        detail: "1 shell · new",
      };
      setNewSession(created);
      setSessionName(created.name);
      setSelectedPaneId(null);
      setStage("session-overview");
    },
  }), [initialWorkspaceState, newSessionName, newSessionWorkspaceId, pickerStatus, selectedTerminal, storyWorkspaces]);

  const sessionPaneBoard = useMemo<PaneBoardViewModel>(() => ({
    isOpen: mapOpen,
    selectedTarget: selectedPaneId ?? "",
    panes: sessionPanes,
    status: "ready",
    errorMessage: null,
    open: () => setMapOpen(true),
    close: () => setMapOpen(false),
    toggle: () => setMapOpen((open) => !open),
    select: (pane) => {
      setSelectedPaneId(pane.tmuxPaneId);
      setMapOpen(false);
    },
    refresh: () => undefined,
  }), [mapOpen, selectedPaneId, sessionPanes]);

  if (stage === "settings") return <ConnectionSettingsView viewModel={connectionSettingsViewModel} />;
  if (stage === "new-session") return <NewSessionView viewModel={newSessionViewModel} />;
  if (stage === "new-pane") return <NewPaneView viewModel={newPaneViewModel} />;
  if (stage === "session-overview") return <SessionOverviewView viewModel={sessionOverviewViewModel} />;
  if (stage === "control-room") return <PaneView viewModel={terminalViewModel} paneBoard={sessionPaneBoard} onSessionSelect={() => setStage("sessions")} onNewPane={() => setStage("new-pane")} />;
  return <StoryConnectionView viewModel={connectionViewModel} connectionSettings={connectionSettingsViewModel} />;
}

function StoryConnectionView({ viewModel, connectionSettings }: { viewModel: ConnectionFlowViewModel; connectionSettings: ConnectionSettingsViewModel }) {
  switch (viewModel.stage) {
    case "terminals":
      return <TerminalsView viewModel={{ ...viewModel, stage: "terminals", connectionSettings } satisfies TerminalsViewModel} />;
    case "sessions":
      return <SessionsView viewModel={{ ...viewModel, stage: "sessions" } satisfies SessionsViewModel} />;
    case "connecting":
      return <ConnectingView viewModel={{ ...viewModel, stage: "connecting" } satisfies ConnectingViewModel} />;
    case "disconnected":
      return <DisconnectedView viewModel={{ ...viewModel, stage: "disconnected" } satisfies DisconnectedViewModel} />;
    case "ended":
      return <EndedView viewModel={{ ...viewModel, stage: "ended" } satisfies EndedViewModel} />;
    default:
      return null;
  }
}

function isConnectionStage(stage: ProductStage): stage is ConnectionFlowStage {
  return stage !== "new-session" && stage !== "session-overview" && stage !== "control-room";
}

const meta = {
  title: "Product/Mobile experience",
  component: MobileExperience,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MobileExperience>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullExperience: Story = {
  name: "Full experience / interactive",
  render: () => <MobileExperience />,
};

export const TerminalPicker: Story = {
  name: "Setup / terminal picker",
  render: () => <MobileExperience initialStage="terminals" />,
};

export const ConnectionSetup: Story = {
  name: "Setup / no connection configured",
  render: () => <ConnectionSettingsView viewModel={{
    hasSavedProfile: false,
    isScanningQr: false,
    isPairingQr: false,
    pairingMessage: null,
    errorMessage: null,
    onClear: () => undefined,
    onBack: () => undefined,
    onOpenQrScanner: () => undefined,
    onCloseQrScanner: () => undefined,
    onQrValue: () => undefined,
  }} />,
};

export const ServeConnectionSettings: Story = {
  name: "Setup / Serve connection settings",
  render: () => <MobileExperience initialStage="settings" initialTerminalId="macbook-air" />,
};

export const SessionPicker: Story = {
  name: "Setup / session picker",
  render: () => <MobileExperience initialStage="sessions" initialTerminalId="macbook-air" />,
};

export const NewSession: Story = {
  name: "Setup / new session",
  render: () => <MobileExperience initialNewSession initialTerminalId="macbook-air" />,
};

export const WorkspaceDirectoryLoading: Story = {
  name: "Setup / workspace directories loading",
  render: () => <MobileExperience initialNewSession initialTerminalId="macbook-air" initialWorkspaceState="loading" />,
};

export const WorkspaceDirectoryError: Story = {
  name: "Setup / workspace directory error",
  render: () => <MobileExperience initialNewSession initialTerminalId="macbook-air" initialWorkspaceState="error" />,
};

export const EmptyAllowedWorkspaceDirectories: Story = {
  name: "Setup / no registered workspaces",
  render: () => <MobileExperience initialNewSession initialTerminalId="macbook-air" initialWorkspaceState="empty" />,
};

export const WorkspaceWorktreePicker: Story = {
  name: "Session / workspace worktree picker",
  render: () => <MobileExperience initialStage="new-pane" initialTerminalId="macbook-air" initialSelectionMode="worktree" />,
};

export const Attaching: Story = {
  name: "Setup / attaching session",
  render: () => <MobileExperience initialStage="connecting" initialTerminalId="macbook-air" initialSessionName="mobile-agent" autoAdvance={false} />,
};

export const SessionReadyNoPane: Story = {
  name: "Session / no pane selected",
  render: () => <MobileExperience initialStage="session-overview" initialTerminalId="macbook-air" initialSessionName="mobile-agent" />,
};

export const NewPane: Story = {
  name: "Session / new pane with placement",
  render: () => <MobileExperience initialStage="new-pane" initialTerminalId="macbook-air" initialSessionName="mobile-agent" />,
};

export const AgentWaiting: Story = {
  name: "Control room / agent waiting",
  render: () => <MobileExperience initialStage="control-room" initialTerminalId="macbook-air" initialSessionName="mobile-agent" initialPaneId="%0" />,
};

export const AgentApproval: Story = {
  name: "Control room / approval waiting",
  render: () => <MobileExperience initialStage="control-room" initialTerminalId="macbook-air" initialSessionName="papercal" initialPaneId="%3" />,
};

export const AgentRunning: Story = {
  name: "Control room / agent running",
  render: () => <MobileExperience initialStage="control-room" initialTerminalId="macbook-air" initialSessionName="mobile-agent" initialPaneId="%1" />,
};

export const Shell: Story = {
  name: "Control room / shell",
  render: () => <MobileExperience initialStage="control-room" initialTerminalId="macbook-air" initialSessionName="mobile-agent" initialPaneId="%2" />,
};

export const GhostMap: Story = {
  name: "Control room / readable window map",
  render: () => <MobileExperience initialStage="control-room" initialTerminalId="macbook-air" initialSessionName="mobile-agent" initialPaneId="%2" initialMapOpen />,
};

export const MobileDisconnected: Story = {
  name: "Recovery / mobile disconnected",
  render: () => <MobileExperience initialStage="disconnected" initialTerminalId="macbook-air" initialSessionName="mobile-agent" />,
};

export const ShellEnded: Story = {
  name: "Recovery / shell ended",
  render: () => <MobileExperience initialStage="ended" initialTerminalId="macbook-air" initialSessionName="mobile-agent" />,
};
