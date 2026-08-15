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

export const worktreeCopyPatternLimits = {
  maxPatterns: 100,
  maxPatternLength: 4_096,
} as const;

export const agentSessionNameLimits = {
  maxLength: 64,
  maxUtf8Bytes: 240,
} as const;

export class InvalidAgentSessionNameError extends Error {
  public readonly code = "invalid_agent_name" as const;

  public constructor() {
    super("Name must contain at least one letter or number after normalization");
    this.name = "InvalidAgentSessionNameError";
  }
}

/**
 * Produces the one name used by an agent session, its worktree, and its git
 * branch. Git accepts more than ASCII, so letters from other scripts remain
 * possible, but the result deliberately removes ref/path hazards and keeps
 * the conservative 1-64 character session limit.
 */
export function normalizeAgentSessionName(value: string): string {
  let normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/\.{2,}/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/\.lock$/iu, "-lock")
    .replace(/-{2,}/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");

  const encoder = new TextEncoder();
  let limited = "";
  let byteLength = 0;
  let codePointCount = 0;
  for (const character of normalized) {
    if (codePointCount >= agentSessionNameLimits.maxLength) break;
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > agentSessionNameLimits.maxUtf8Bytes) break;
    limited += character;
    byteLength += characterBytes;
    codePointCount += 1;
  }
  normalized = limited.replace(/^[._-]+|[._-]+$/gu, "");

  if (!normalized || !/^[\p{L}\p{N}]/u.test(normalized)) {
    throw new InvalidAgentSessionNameError();
  }
  return normalized;
}

/**
 * Worktree copy patterns are relative, slash-separated git paths. The
 * wildcard matcher supports `*` and `**`; keeping validation here lets the
 * host adapters and the CLI apply the same path-safety rules.
 */
export function isValidWorktreeCopyPattern(value: string): boolean {
  const pattern = value.trim();
  if (!pattern || pattern.length > worktreeCopyPatternLimits.maxPatternLength) return false;
  if (pattern.includes("\\") || pattern.includes("\u0000")) return false;
  if (pattern.startsWith("/") || /^[A-Za-z]:/.test(pattern)) return false;
  return pattern.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function normalizeWorktreeCopyPatterns(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export type WorkspaceRecord = {
  id: WorkspaceId;
  rootPath: string;
  name: string;
  isGit: boolean;
  setupScriptPath: string | null;
  cleanupScriptPath: string | null;
  worktreeCopyPatterns: string[];
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
export type WorkspaceDirectoryOption = Pick<WorkspaceRecord, "id" | "name" | "rootPath" | "isGit" | "setupScriptPath" | "cleanupScriptPath" | "worktreeCopyPatterns">;

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
  executionId?: string | null;
  executionPid?: number | null;
  executionStartedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaneRecord = {
  id: PaneId;
  tmuxPaneId: string;
  /** Identifies the tmux server generation that owned this pane id. */
  tmuxServerId?: string;
  /** Links a live pane to the durable agent session it is executing. */
  agentSessionId?: string | null;
  /** Identifies the current execution so stale cleanup cannot clear a newer adoption. */
  agentExecutionId?: string | null;
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
  // Present for live tmux snapshots. Persisted rows may omit the volatile
  // position because pane indexes are scoped to a window and can be changed.
  paneIndex?: number;
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
