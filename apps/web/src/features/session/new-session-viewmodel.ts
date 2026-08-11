import type { TerminalEndpoint } from "../connection/connection-flow-viewmodel";

export type NewSessionViewModel = {
  terminal: TerminalEndpoint;
  name: string;
  cwd: string;
  isCreating?: boolean;
  errorMessage?: string | null;
  onNameChange: (value: string) => void;
  onCwdChange: (value: string) => void;
  onBack: () => void;
  onCreate: () => void;
};
