import type { PaneSummary } from "@muximo/protocol";
import type { TerminalEndpoint, TmuxSession } from "../connection/connection-flow-viewmodel";

export type SessionOverviewViewModel = {
  terminal: TerminalEndpoint;
  session: TmuxSession;
  panes: PaneSummary[];
  status?: "loading" | "ready" | "error";
  errorMessage?: string | null;
  onSelectPane: (pane: PaneSummary) => void;
  onCreatePane: () => void;
  onBack: () => void;
  onDisconnect: () => void;
};
