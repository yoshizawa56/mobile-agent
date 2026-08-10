import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useState } from "react";
import type { PanePlacement, PaneSummary } from "@mobile-agent/protocol";
import { ConnectionFlowView } from "../connection/connection-flow-view";
import { ConnectionSettingsView } from "../connection/connection-settings-view";
import { mockSessions, mockTerminals } from "../connection/connection-flow-mock-data";
import type { ConnectionFlowStage, ConnectionFlowViewModel, TmuxSession } from "../connection/connection-flow-viewmodel";
import { NewSessionView, type NewSessionViewModel } from "../session/new-session-view";
import { SessionOverviewView } from "../session/session-overview-view";
import type { SessionOverviewViewModel } from "../session/session-overview-viewmodel";
import { PaneView } from "../pane/pane-view";
import { NewPaneView, type NewPaneAgent, type NewPaneKind } from "../pane/new-pane-view";
import { usePaneViewModel } from "../pane/pane-viewmodel";
import type { PaneBoardViewModel } from "../pane-board/pane-board-viewmodel";
import { mockPanes } from "../../mock/mock-data";

type ProductStage = ConnectionFlowStage | "new-session" | "new-pane" | "session-overview" | "control-room";

function MobileExperience({ initialStage = "terminals", initialTerminalId = null, initialSessionName = null, initialPaneId = null, initialMapOpen = false, initialNewSession = false, autoAdvance = true }: { initialStage?: ProductStage; initialTerminalId?: string | null; initialSessionName?: string | null; initialPaneId?: string | null; initialMapOpen?: boolean; initialNewSession?: boolean; autoAdvance?: boolean }) {
  const [stage, setStage] = useState<ProductStage>(initialNewSession ? "new-session" : initialStage);
  const [terminalId, setTerminalId] = useState<string | null>(initialTerminalId);
  const [sessionName, setSessionName] = useState<string | null>(initialSessionName);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(initialPaneId);
  const [mapOpen, setMapOpen] = useState(initialMapOpen);
  const [connectionStep, setConnectionStep] = useState(initialStage === "connecting" ? 2 : 0);
  const [newSession, setNewSession] = useState<TmuxSession | null>(null);
  const [newSessionName, setNewSessionName] = useState("design-lab");
  const [newSessionCwd, setNewSessionCwd] = useState("~/work/mobile-agent");
  const [settingsName, setSettingsName] = useState("MacBook Air");
  const [settingsUrl, setSettingsUrl] = useState("https://macbook-air.tailnet.ts.net");
  const [newPaneName, setNewPaneName] = useState("review");
  const [newPaneCwd, setNewPaneCwd] = useState("~/work/mobile-agent");
  const [newPaneKind, setNewPaneKind] = useState<NewPaneKind>("agent");
  const [newPaneAgent, setNewPaneAgent] = useState<NewPaneAgent>("codex");
  const [newPaneWorktree, setNewPaneWorktree] = useState(false);
  const [newPaneProject, setNewPaneProject] = useState("mobile-agent");
  const [newPanePlacement, setNewPanePlacement] = useState<PanePlacement>("right");
  const [newPaneTargetPaneId, setNewPaneTargetPaneId] = useState<string | null>("%0");

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
      cwd: newSession.cwd,
      projectId: newSession.project,
      state: "running" as const,
      title: "zsh",
    }];
  }, [newSession]);
  const sessionPanes = selectedSession ? panes.filter((pane) => pane.sessionName === selectedSession.name) : [];
  const paneTarget = selectedPaneId ?? sessionPanes[0]?.tmuxPaneId ?? "%0";
  const terminalViewModel = usePaneViewModel({ target: paneTarget });

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
    cwd: newPaneCwd,
    kind: newPaneKind,
    agentId: newPaneAgent,
    useWorktree: newPaneWorktree,
    projectName: newPaneProject,
    existingPanes: sessionPanes,
    placement: newPanePlacement,
    targetPaneId: newPaneTargetPaneId,
    isCreating: false,
    errorMessage: null,
    onNameChange: setNewPaneName,
    onCwdChange: setNewPaneCwd,
    onKindChange: setNewPaneKind,
    onAgentChange: setNewPaneAgent,
    onUseWorktreeChange: setNewPaneWorktree,
    onProjectNameChange: setNewPaneProject,
    onPlacementChange: setNewPanePlacement,
    onTargetPaneChange: setNewPaneTargetPaneId,
    onCreate: () => setStage("session-overview"),
    onBack: () => setStage("session-overview"),
  }), [newPaneAgent, newPaneCwd, newPaneKind, newPaneName, newPanePlacement, newPaneProject, newPaneTargetPaneId, newPaneWorktree, selectedSession, selectedTerminal, sessionPanes]);

  const newSessionViewModel = useMemo<NewSessionViewModel>(() => ({
    terminal: selectedTerminal,
    name: newSessionName,
    cwd: newSessionCwd,
    onNameChange: setNewSessionName,
    onCwdChange: setNewSessionCwd,
    onBack: () => setStage("sessions"),
    onCreate: () => {
      const created: TmuxSession = {
        name: newSessionName.trim(),
        project: newSessionName.trim(),
        cwd: newSessionCwd.trim(),
        paneCount: 1,
        waitingCount: 0,
        detail: "1 shell · new",
        state: "active",
      };
      setNewSession(created);
      setSessionName(created.name);
      setSelectedPaneId(null);
      setStage("session-overview");
    },
  }), [newSessionCwd, newSessionName, selectedTerminal]);

  const sessionPaneBoard = useMemo<PaneBoardViewModel>(() => ({
    isOpen: mapOpen,
    selectedTarget: selectedPaneId ?? "",
    panes: sessionPanes,
    status: "ready",
    errorMessage: null,
    toggle: () => setMapOpen((open) => !open),
    select: (pane) => {
      setSelectedPaneId(pane.tmuxPaneId);
      setMapOpen(false);
    },
    refresh: () => undefined,
  }), [mapOpen, selectedPaneId, sessionPanes]);

  if (stage === "settings") return <ConnectionSettingsView viewModel={{
    name: settingsName,
    serveUrl: settingsUrl,
    hasSavedProfile: true,
    isSaving: false,
    errorMessage: null,
    onNameChange: setSettingsName,
    onServeUrlChange: setSettingsUrl,
    onSave: () => setStage("terminals"),
    onClear: () => setStage("terminals"),
    onBack: () => setStage("terminals"),
  }} />;
  if (stage === "new-session") return <NewSessionView viewModel={newSessionViewModel} />;
  if (stage === "new-pane") return <NewPaneView viewModel={newPaneViewModel} />;
  if (stage === "session-overview") return <SessionOverviewView viewModel={sessionOverviewViewModel} />;
  if (stage === "control-room") return <PaneView viewModel={terminalViewModel} paneBoard={sessionPaneBoard} onWorkspaceSwitch={() => setStage("sessions")} onNewPane={() => setStage("new-pane")} />;
  return <ConnectionFlowView viewModel={connectionViewModel} />;
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
  name: "Control room / ghost map",
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
