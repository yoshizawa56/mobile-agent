import type { PanePlacement, PaneSummary } from "@mobile-agent/protocol";
import type { TerminalEndpoint, TmuxSession } from "../connection/connection-flow-viewmodel";

export type NewPaneKind = "agent" | "shell";
export type NewPaneAgent = "codex" | "claude";

export type NewPaneViewModel = {
  terminal: TerminalEndpoint;
  session: TmuxSession;
  name: string;
  cwd: string;
  kind: NewPaneKind;
  agentId: NewPaneAgent;
  useWorktree: boolean;
  projectName: string;
  existingPanes: PaneSummary[];
  placement: PanePlacement;
  targetPaneId: string | null;
  isCreating: boolean;
  errorMessage: string | null;
  onNameChange: (value: string) => void;
  onCwdChange: (value: string) => void;
  onKindChange: (value: NewPaneKind) => void;
  onAgentChange: (value: NewPaneAgent) => void;
  onUseWorktreeChange: (value: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onPlacementChange: (value: PanePlacement) => void;
  onTargetPaneChange: (value: string) => void;
  onCreate: () => void;
  onBack: () => void;
};
