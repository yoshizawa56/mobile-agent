import type { TerminalEndpoint } from "../connection/connection-flow-viewmodel";
import type { WorkspacePickerViewModel } from "../workspace/workspace-picker-viewmodel";

export type NewSessionViewModel = {
  terminal: TerminalEndpoint;
  name: string;
  workspacePicker: WorkspacePickerViewModel;
  isCreating?: boolean;
  errorMessage?: string | null;
  onNameChange: (value: string) => void;
  onBack: () => void;
  onCreate: () => void;
};
