export type ConnectionFlowStage = "terminals" | "sessions" | "connecting" | "disconnected" | "ended" | "settings";

export type TerminalEndpoint = {
  id: string;
  name: string;
  host: string;
  tailnetIp: string;
  state: "online" | "offline";
  detail: string;
  lastSeen: string;
};

export type TmuxSession = {
  name: string;
  workspace: string;
  cwd: string;
  paneCount: number;
  waitingCount: number;
  detail: string;
  state: "active" | "idle";
};

export type ConnectionFlowViewModel = {
  stage: ConnectionFlowStage;
  terminals: TerminalEndpoint[];
  sessions: TmuxSession[];
  selectedTerminal: TerminalEndpoint | null;
  selectedSession: TmuxSession | null;
  connectionStep: number;
  status?: "loading" | "ready" | "error";
  errorMessage?: string | null;
  onSelectTerminal: (terminal: TerminalEndpoint) => void;
  onSelectSession: (session: TmuxSession) => void;
  onCreateSession: () => void;
  onBack: () => void;
  onOpenSessionOverview: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onChooseTerminal: () => void;
  onOpenSettings: () => void;
};
