import type { PanePlacement, PaneSummary } from "@mobile-agent/protocol";
import type { TerminalEndpoint, TmuxSession } from "../connection/connection-flow-viewmodel";
import type { WorkspacePickerViewModel } from "../workspace/workspace-picker-viewmodel";

export type NewPaneKind = "agent" | "shell";
export type NewPaneAgent = "codex" | "claude";

export type NewPaneViewModel = {
  terminal: TerminalEndpoint;
  session: TmuxSession;
  name: string;
  workspacePicker: WorkspacePickerViewModel;
  kind: NewPaneKind;
  agentId: NewPaneAgent;
  existingPanes: PaneSummary[];
  placement: PanePlacement;
  targetPaneId: string | null;
  isCreating: boolean;
  errorMessage: string | null;
  onNameChange: (value: string) => void;
  onKindChange: (value: NewPaneKind) => void;
  onAgentChange: (value: NewPaneAgent) => void;
  onPlacementChange: (value: PanePlacement) => void;
  onTargetPaneChange: (value: string) => void;
  onCreate: () => void;
  onBack: () => void;
};
