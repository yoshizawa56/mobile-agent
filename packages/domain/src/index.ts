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
  setupScriptPath: string | null;
  cleanupScriptPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export const workspaceSelectionModes = ["workspace", "worktree"] as const;
export type WorkspaceSelectionMode = (typeof workspaceSelectionModes)[number];

/**
 * The host-side directory choices exposed to the mobile client. The path is
 * resolved by agentd from an allowed-root policy; clients send the stable id
 * back instead of choosing an arbitrary cwd.
 */
export type WorkspaceDirectoryOption = Pick<WorkspaceRecord, "id" | "name" | "rootPath" | "isGit" | "setupScriptPath" | "cleanupScriptPath">;

export type WorkspaceSelection = {
  workspaceId: WorkspaceId;
  mode: WorkspaceSelectionMode;
};

export type WorkspaceSelectionErrorCode =
  | "workspace_not_found"
  | "worktree_not_supported";

export class WorkspaceSelectionError extends Error {
  public constructor(
    public readonly code: WorkspaceSelectionErrorCode,
    message: string,
    public readonly details: { workspaceId: WorkspaceId },
  ) {
    super(message);
    this.name = "WorkspaceSelectionError";
  }
}

/**
 * Applies the domain rules shared by the HTTP adapter and future CLI/native
 * adapters. Filesystem existence and allowed-root checks stay in the host
 * adapter; this function only validates the selected domain records.
 */
export function validateWorkspaceSelection(
  selection: WorkspaceSelection,
  workspace: WorkspaceDirectoryOption | undefined,
): WorkspaceSelection {
  if (!workspace) {
    throw new WorkspaceSelectionError(
      "workspace_not_found",
      `Workspace directory not found: ${selection.workspaceId}`,
      { workspaceId: selection.workspaceId },
    );
  }
  if (selection.mode === "worktree" && !workspace.isGit) {
    throw new WorkspaceSelectionError(
      "worktree_not_supported",
      `Workspace does not support worktrees: ${workspace.rootPath}`,
      { workspaceId: selection.workspaceId },
    );
  }
  return selection;
}

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
