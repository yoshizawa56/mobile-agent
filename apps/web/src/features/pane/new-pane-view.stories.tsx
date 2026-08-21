import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import type { PanePlacement, PaneSummary, WorkspaceDirectory } from "@muximo/api";
import { NewPaneView } from "./new-pane-view";
import type { NewPaneAgent, NewPaneKind, NewPaneViewModel } from "./new-pane-viewmodel";
import type { WorkspaceSelectionMode } from "../workspace/workspace-picker-viewmodel";

const storyPanes: PaneSummary[] = [
  {
    id: "pane-review",
    tmuxPaneId: "%0",
    sessionName: "muximo",
    windowId: "@0",
    paneIndex: 0,
    kind: "agent",
    name: "Review the viewport lease",
    cwd: "~/work/muximo",
    workspaceId: "muximo",
    agentId: "codex",
    state: "waiting_input",
    title: "codex · review",
    lastSeenAt: "2026-08-10T06:55:00.000Z",
  },
  {
    id: "pane-shell",
    tmuxPaneId: "%2",
    sessionName: "muximo",
    windowId: "@1",
    paneIndex: 0,
    kind: "shell",
    name: "Local shell",
    cwd: "~/work/muximo",
    workspaceId: "muximo",
    agentId: null,
    state: "running",
    title: "zsh",
    lastSeenAt: "2026-08-10T06:58:00.000Z",
  },
];

const storyWorkspaces: WorkspaceDirectory[] = [{
  id: "workspace-muximo",
  name: "muximo",
  directory: "~/work/muximo",
  isGit: true,
  setupScriptPath: "~/.config/muximo/setup",
  cleanupScriptPath: "~/.config/muximo/cleanup",
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

function buildViewModel(overrides: Partial<NewPaneViewModel> = {}): NewPaneViewModel {
  return {
    terminal: {
      id: "macbook-air",
      name: "MacBook Air",
      host: "toru-macbook-air",
      tailnetIp: "100.112.247.15",
      state: "online",
      detail: "muximod 0.1 · macOS",
      lastSeen: "active now",
    },
    session: {
      name: "muximo",
      paneCount: 2,
      waitingCount: 1,
      detail: "1 agent · 1 shell · waiting input",
    },
    name: "review",
    workspacePicker: {
      workspaces: storyWorkspaces,
      workspaceCandidates: storyWorkspaces,
      workspaceId: "workspace-muximo",
      mode: "workspace",
      workspaceStatus: "ready",
      browserStatus: "ready",
      browserPath: null,
      registrationOpen: false,
      registrationDirectory: "",
      setupScriptPath: "",
      cleanupScriptPath: "",
      worktreeCopyPatterns: "",
      isRegisteringWorkspace: false,
      registrationError: null,
      errorMessage: null,
      onWorkspaceChange: () => undefined,
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
    kind: "agent",
    agentId: "codex",
    existingPanes: storyPanes,
    placement: "right",
    targetPaneId: "%0",
    isCreating: false,
    errorMessage: null,
    onNameChange: () => undefined,
    onKindChange: () => undefined,
    onAgentChange: () => undefined,
    onPlacementChange: () => undefined,
    onTargetPaneChange: () => undefined,
    onCreate: () => undefined,
    onBack: () => undefined,
    ...overrides,
  };
}

function NewPaneStory({ initialPanes = storyPanes, initialPlacement = "right", initialMode = "workspace", initialKind = "agent" }: { initialPanes?: PaneSummary[]; initialPlacement?: PanePlacement; initialMode?: WorkspaceSelectionMode; initialKind?: NewPaneKind }) {
  const [name, setName] = useState("review");
  const [kind, setKind] = useState<NewPaneKind>(initialKind);
  const [agentId, setAgentId] = useState<NewPaneAgent>("codex");
  const [placement, setPlacement] = useState<PanePlacement>(initialPlacement);
  const [targetPaneId, setTargetPaneId] = useState<string | null>(initialPanes[0]?.tmuxPaneId ?? null);
  const [mode, setMode] = useState<WorkspaceSelectionMode>(initialMode);

  const viewModel = useMemo<NewPaneViewModel>(() => buildViewModel({
    name,
    kind,
    agentId,
    placement,
    targetPaneId,
    existingPanes: initialPanes,
    workspacePicker: {
      ...buildViewModel().workspacePicker,
      mode,
      onModeChange: setMode,
    },
    onNameChange: setName,
    onKindChange: (nextKind: NewPaneKind) => {
      setKind(nextKind);
      if (nextKind === "shell") setMode("workspace");
    },
    onAgentChange: setAgentId,
    onPlacementChange: setPlacement,
    onTargetPaneChange: setTargetPaneId,
  }), [agentId, initialPanes, kind, mode, name, placement, targetPaneId]);

  return <NewPaneView viewModel={viewModel} />;
}

const meta = {
  title: "Pane/New pane form",
  component: NewPaneView,
  args: {
    viewModel: buildViewModel(),
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof NewPaneView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentWithExistingPanes: Story = {
  name: "Agent / existing panes",
  render: () => <NewPaneStory />,
};

export const AgentNewWindow: Story = {
  name: "Agent / new window",
  render: () => <NewPaneStory initialPlacement="window" />,
};

export const AgentWorktreeMode: Story = {
  name: "Agent / worktree mode",
  render: () => <NewPaneStory initialPlacement="window" initialMode="worktree" />,
};

export const AgentWorktreeSplit: Story = {
  name: "Agent / worktree + split right",
  render: () => <NewPaneStory initialPlacement="right" initialMode="worktree" />,
};

export const ShellPane: Story = {
  name: "Shell",
  render: () => <NewPaneStory initialPlacement="right" initialKind="shell" />,
};

export const ShellWorktreeSplit: Story = {
  name: "Shell / worktree + split right",
  render: () => <NewPaneStory initialPlacement="right" initialMode="worktree" initialKind="shell" />,
};

export const ShellWorktreeWindow: Story = {
  name: "Shell / worktree in new window",
  render: () => <NewPaneStory initialPlacement="window" initialMode="worktree" initialKind="shell" />,
};

export const EmptySession: Story = {
  name: "Empty session / window only",
  render: () => <NewPaneStory initialPanes={[]} />,
};
