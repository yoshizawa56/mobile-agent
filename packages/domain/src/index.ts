export const paneKinds = ["agent", "shell", "unknown"] as const;
export type PaneKind = (typeof paneKinds)[number];

export const runStates = [
  "starting",
  "running",
  "waiting_input",
  "waiting_approval",
  "failed",
  "completed",
  "stopped",
] as const;
export type RunState = (typeof runStates)[number];

export type PaneId = string;
export type RunId = string;
export type ProjectId = string;
export type WorkspaceId = string;

export const agentBackends = ["codex", "claude"] as const;
export type AgentBackend = (typeof agentBackends)[number];

export const agentSessionStates = [
  "starting",
  "setup",
  "setup_failed",
  "ready",
  "running",
  "resuming",
  "interrupted",
  "exited",
] as const;
export type AgentSessionState = (typeof agentSessionStates)[number];

export type WorkspaceRecord = {
  id: WorkspaceId;
  rootPath: string;
  name: string;
  isGit: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecord = {
  id: ProjectId;
  name: string;
  directory: string;
  setupHook: string | null;
  cleanupHook: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionRecord = {
  id: string;
  name: string;
  backend: AgentBackend;
  status: AgentSessionState;
  workspaceId: WorkspaceId;
  workspaceRoot: string;
  workspaceName: string;
  worktreeRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
  baseCommit: string | null;
  useWorktree: boolean;
  projectId: ProjectId | null;
  projectName: string | null;
  projectDirectory: string | null;
  setupHook: string | null;
  cleanupHook: string | null;
  setupOutputFile: string | null;
  cleanupOutputFile: string | null;
  backendSessionId: string | null;
  codexProfile: string | null;
  codexRemote: string | null;
  setupRan: boolean;
  resuming: boolean;
  baselineStatus: string | null;
  codexSessionBaseline: string | null;
  lastExitStatus: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PaneRecord = {
  id: PaneId;
  tmuxPaneId: string;
  sessionName: string;
  windowId: string;
  kind: PaneKind;
  name: string;
  cwd: string;
  projectId: ProjectId | null;
  workspaceId: WorkspaceId | null;
  agentId: string | null;
  runId: RunId | null;
  state: RunState;
  title: string | null;
  lastSeenAt: string;
  windowName?: string;
  windowIndex?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  windowWidth?: number;
  windowHeight?: number;
};

export type RunRecord = {
  id: RunId;
  paneId: PaneId;
  agentId: string | null;
  profileId: string | null;
  state: RunState;
  startedAt: string;
  endedAt: string | null;
};

export type RunStateTransition = {
  from: RunState;
  to: RunState;
  reason: string;
  at: string;
};

const terminalStates = new Set<RunState>(["failed", "completed", "stopped"]);

/**
 * Validates a state transition without knowing anything about an agent or
 * transport. Plugins can emit a normalized state and the application layer
 * can use this function before persisting it.
 */
export function canTransitionRunState(from: RunState, to: RunState): boolean {
  if (from === to) return true;
  if (terminalStates.has(from)) return false;
  if (to === "starting") return from === "starting";
  return true;
}

export function transitionRunState(
  current: RunState,
  next: RunState,
  reason: string,
  at = new Date().toISOString(),
): RunStateTransition {
  if (!canTransitionRunState(current, next)) {
    throw new Error(`Invalid run state transition: ${current} -> ${next}`);
  }
  return { from: current, to: next, reason, at };
}

export function isAttentionState(state: RunState): boolean {
  return state === "waiting_input" || state === "waiting_approval" || state === "failed";
}

export function paneKindForCommand(command: string): PaneKind {
  const executable = command.trim().toLowerCase().split(/\s+/, 1)[0]?.split("/").at(-1) ?? "";
  if (!executable || executable === "zsh" || executable === "bash" || executable === "fish" || executable === "sh") {
    return "shell";
  }
  if (["agent", "codex", "claude", "aider", "opencode", "gemini"].includes(executable)) return "agent";
  return "unknown";
}
