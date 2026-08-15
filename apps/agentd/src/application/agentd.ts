import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename } from "node:path";
import { ApplicationError, type AgentSessionRepository, type AgentdApplication, type PaneRepository, type WorkspaceRepository } from "@mobile-agent/application";
import { normalizeAgentSessionName, paneKindForCommand, type AgentSessionRecord, type PaneRecord, type WorkspaceRecord } from "@mobile-agent/domain";
import type { CreatePaneRequest, PaneSummary, TerminalEndpoint, TmuxSession } from "@mobile-agent/protocol";
import { buildAgentShellCommand, configureManagedTmuxSession, resolveAgentCommand, TmuxAdapter, type TmuxPane, type TmuxLiveSnapshot } from "../tmux.js";
import { TmuxViewportManager } from "../viewport-manager.js";
import { WorkspaceSelectionCatalog } from "../workspace-selection.js";

export type AgentdApplicationResources = {
  getTerminal: () => Promise<TerminalEndpoint>;
  tmux: TmuxAdapter;
  paneRepository: PaneRepository;
  agentSessionRepository: AgentSessionRepository;
  workspaceCatalog: WorkspaceSelectionCatalog;
  workspaceRepository: WorkspaceRepository;
  viewportManager: TmuxViewportManager;
};

export type AgentdApplicationRuntime = AgentdApplication & {
  reconcile(live?: TmuxLiveSnapshot): Promise<PaneRecord[]>;
  adoptAgentSession(request: { agentSessionId: string; tmuxPaneId: string; executionId: string }): Promise<void>;
  releaseAgentSession(request: { agentSessionId: string; tmuxPaneId: string; executionId: string }): Promise<void>;
};

export function createAgentdApplication(resources: AgentdApplicationResources): AgentdApplicationRuntime {
  const { tmux, paneRepository, agentSessionRepository, workspaceCatalog, viewportManager, workspaceRepository } = resources;
  return {
    terminal: { get: resources.getTerminal },
    workspaces: {
      list: async () => (await workspaceRepository.list()).map((workspace) => workspaceCatalog.toDirectoryOption(workspace)),
      browse: (parentPath) => workspaceCatalog.browseDirectories(parentPath),
      register: async (input) => {
        const candidate = workspaceCatalog.registerWorkspace(input);
        const existing = await workspaceRepository.findById(candidate.id);
        const workspace = workspaceCatalog.registerWorkspace(input, existing);
        await workspaceRepository.upsert(workspace);
        return workspaceCatalog.toDirectoryOption(workspace);
      },
      resolveDirectory: (workspaceId) => workspaceCatalog.resolveWorkspaceDirectory(workspaceId, (id) => workspaceRepository.findById(id)),
      resolveSelection: (selection) => workspaceCatalog.resolveSelection(selection, (id) => workspaceRepository.findById(id)),
    },
    sessions: {
      list: () => listSessions(tmux, paneRepository, agentSessionRepository),
      create: (input) => createSession(input, tmux, paneRepository, agentSessionRepository, workspaceCatalog),
    },
    panes: {
      list: (sessionName) => listCurrentPanes(tmux, paneRepository, agentSessionRepository, sessionName),
      create: (input, workspace) => createPane(input, tmux, paneRepository, agentSessionRepository, viewportManager, workspaceCatalog, workspace),
    },
    hooks: { handleTmux: (event, client) => viewportManager.handleTmuxHook(event, client) },
    reconcile: (live) => syncPanes(tmux, paneRepository, agentSessionRepository, live),
    adoptAgentSession: (request) => adoptAgentSession(tmux, paneRepository, agentSessionRepository, request),
    releaseAgentSession: (request) => releaseAgentSession(tmux, paneRepository, agentSessionRepository, request),
  };
}

async function listSessions(
  tmux: TmuxAdapter,
  paneRepository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
): Promise<TmuxSession[]> {
  const panes = await syncPanes(tmux, paneRepository, agentSessionRepository);
  return summarizeSessions(panes);
}

async function createSession(
  input: { name: string; cwd: string; workspaceId?: string },
  tmux: TmuxAdapter,
  paneRepository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
  workspaceCatalog: WorkspaceSelectionCatalog,
): Promise<TmuxSession> {
  const cwd = await workspaceCatalog.resolveLegacyDirectory(input.cwd);
  if (tmux.hasSession(input.name)) {
    throw new ApplicationError("session_exists", `tmux session already exists: ${input.name}`);
  }

  const managedSessionId = randomUUID();
  let created = false;
  try {
    const binary = resolveAgentCommand();
    tmux.createSession(input.name, cwd, buildAgentShellCommand(binary, {
      AGENTD_MANAGED_SESSION_ID: managedSessionId,
      AGENTD_MANAGED_SESSION_NAME: input.name,
    }));
    created = true;
    configureManagedTmuxSession(tmux, input.name, managedSessionId, binary);
    const panes = await syncPanes(tmux, paneRepository, agentSessionRepository);
    const initialPane = panes.find((pane) => pane.sessionName === input.name);
    if (initialPane) {
      const shellPane: PaneRecord = {
        ...initialPane,
        kind: "shell",
        agentId: null,
        state: "running",
      };
      await paneRepository.upsert(shellPane);
      tmux.setAgentPaneMetadata(initialPane.tmuxPaneId, "kind", "shell");
      tmux.setAgentPaneMetadata(initialPane.tmuxPaneId, "agent_id", "");
      tmux.setAgentPaneMetadata(initialPane.tmuxPaneId, "managed_session_id", managedSessionId);
    }
    const currentPanes = initialPane
      ? panes.map((pane) => pane.id === initialPane.id ? {
          ...pane,
          kind: "shell" as const,
          agentId: null,
          state: "running" as const,
        } : pane)
      : panes;
    const session = summarizeSessions(currentPanes.filter((pane) => pane.sessionName === input.name)).find((candidate) => candidate.name === input.name);
    if (!session || !currentPanes.some((pane) => pane.sessionName === input.name)) {
      throw new ApplicationError("session_not_visible", "tmux created the session but agentd could not read it");
    }
    return session;
  } catch (error) {
    if (created) {
      try {
        tmux.killSession(input.name);
      } catch {
        // Preserve the original setup error; cleanup is best effort.
      }
    }
    throw error;
  }
}

async function listCurrentPanes(
  tmux: TmuxAdapter,
  paneRepository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
  sessionName?: string,
): Promise<PaneRecord[]> {
  const panes = await syncPanes(tmux, paneRepository, agentSessionRepository);
  return sessionName ? panes.filter((pane) => pane.sessionName === sessionName) : panes;
}

async function createPane(
  input: CreatePaneRequest,
  tmux: TmuxAdapter,
  repository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
  viewportManager: TmuxViewportManager,
  workspaceCatalog: WorkspaceSelectionCatalog,
  workspace?: WorkspaceRecord,
): Promise<PaneSummary> {
  if (!tmux.hasSession(input.sessionName)) {
    throw new ApplicationError("session_not_found", `tmux session does not exist: ${input.sessionName}`);
  }
  if (input.kind === "agent" && !input.agentId) {
    throw new ApplicationError("agent_required", "agentId is required for an agent pane");
  }
  if (input.kind === "shell" && input.agentId) {
    throw new ApplicationError("agent_not_allowed", "agentId is not allowed for a shell pane");
  }

  if (!input.cwd) {
    throw new ApplicationError("invalid_directory", "A workspace directory is required");
  }
  const cwd = await workspaceCatalog.resolveLegacyDirectory(input.cwd);

  const paneName = input.kind === "agent" ? normalizeAgentSessionName(input.name) : input.name;
  const commandInput = paneName === input.name ? input : { ...input, name: paneName };
  const command = buildAgentShellCommand(
    resolveAgentCommand(),
    { AGENTD_MANAGED_SESSION_NAME: input.sessionName, AGENTD_PANE_NAME: paneName },
    input.kind === "agent" ? agentCommand(commandInput, workspace) : undefined,
  );
  const tmuxPaneId = input.placement === "window"
    ? tmux.newWindow(input.sessionName, cwd, command)
    : createSplitPane(input, tmux, cwd, command);
  if (input.placement !== "window" && input.targetPaneId) {
    viewportManager.reassertMobileViewport(input.targetPaneId);
  }
  const panes = await syncPanes(tmux, repository, agentSessionRepository);
  const current = panes.find((pane) => pane.tmuxPaneId === tmuxPaneId);
  if (!current) {
    throw new ApplicationError("pane_not_visible", "tmux created the pane but agentd could not read it");
  }

  const record: PaneSummary = {
    ...current,
    kind: input.kind,
    name: paneName,
    workspaceId: input.workspaceId ?? current.workspaceId,
    agentId: input.agentId,
    state: input.kind === "agent" ? "starting" : "running",
  };
  await repository.upsert(record);
  tmux.setAgentPaneMetadata(tmuxPaneId, "pane_id", record.id);
  tmux.setAgentPaneMetadata(tmuxPaneId, "pane_name", paneName);
  tmux.setAgentPaneMetadata(tmuxPaneId, "agent_id", input.agentId ?? "");
  tmux.setAgentPaneMetadata(tmuxPaneId, "kind", input.kind);
  tmux.setAgentPaneMetadata(tmuxPaneId, "workspace_id", input.workspaceId ?? "");
  return record;
}

function createSplitPane(input: CreatePaneRequest, tmux: TmuxAdapter, cwd: string, command: string | undefined): string {
  if (input.placement === "window") {
    throw new ApplicationError("split_placement_required", "A split placement is required");
  }
  if (!input.targetPaneId) {
    throw new ApplicationError("target_pane_required", "targetPaneId is required for a split pane");
  }

  const target = tmux.resolvePane(input.targetPaneId);
  const windowSnapshot = tmux.snapshotWindow(target);
  if (target.sessionName !== input.sessionName) {
    throw new ApplicationError("target_pane_session_mismatch", "targetPaneId belongs to a different tmux session");
  }

  return tmux.splitWindow(cwd, command, input.placement, input.targetPaneId, windowSnapshot.zoomed);
}

async function syncPanes(
  tmux: TmuxAdapter,
  repository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
  live = tmux.listPanesSnapshot(),
): Promise<PaneRecord[]> {
  const now = new Date().toISOString();
  const records: PaneRecord[] = [];
  const tmuxServerId = live.tmuxServerId ?? "legacy";
  const managedAgentCommand = resolveAgentCommand();

  for (const tmuxPane of live.panes) {
    const paneServerId = tmuxPane.tmuxServerId ?? tmuxServerId;
    const existing = await repository.findByTmuxPaneIdentity(paneServerId, tmuxPane.paneId);
    const sessionCandidate = tmuxPane.agentdSessionId ? await agentSessionRepository.findById(tmuxPane.agentdSessionId) : undefined;
    const adoptedSession = sessionCandidate
      && tmuxPane.agentdExecutionId === sessionCandidate.executionId
      && isLiveAgentExecution(sessionCandidate)
      && isManagedAgentCommand(tmuxPane.command, sessionCandidate.backend, managedAgentCommand)
      ? sessionCandidate
      : undefined;
    const staleAgentMetadata = tmuxPane.agentdKind === "agent"
      && Boolean(tmuxPane.agentdSessionId)
      && Boolean(tmuxPane.agentdRunId)
      && !adoptedSession;
    if (tmuxPane.agentdSessionId && !adoptedSession) {
      try {
        const cleared = tmux.clearAgentExecutionMetadata(tmuxPane.paneId, tmuxPane.agentdExecutionId ?? "");
        if (cleared && tmuxPane.agentdKind === "agent" && tmuxPane.agentdRunId) {
          tmux.resetAgentPaneMetadata(tmuxPane.paneId);
        }
      } catch {
        // The pane may disappear while stale adoption metadata is being cleared.
      }
    }
    const metadataId = tmuxPane.agentdPaneId;
    const conflictingId = !existing && metadataId ? await repository.findById(metadataId) : undefined;
    const reusableMetadataId = metadataId && (!conflictingId || (conflictingId.tmuxServerId === paneServerId && conflictingId.tmuxPaneId === tmuxPane.paneId))
      ? metadataId
      : undefined;
    const kind = resolvePaneKind(tmuxPane, existing, adoptedSession !== undefined, staleAgentMetadata);
    const agentId = kind === "agent" ? tmuxPane.agentdAgentId ?? adoptedSession?.backend ?? executableName(tmuxPane.command) ?? existing?.agentId ?? "agent" : null;
    const state = kind === "agent" ? inferAgentState(tmux, tmuxPane, existing?.state ?? "running") : "running";
    const name = staleAgentMetadata
      ? tmuxPane.title || tmuxPane.command || tmuxPane.paneId
      : tmuxPane.agentdName ?? adoptedSession?.name ?? (existing?.name && existing.name !== tmuxPane.paneId ? existing.name : tmuxPane.title || tmuxPane.command || tmuxPane.paneId);
    const record: PaneRecord = {
      id: existing?.id ?? reusableMetadataId ?? `pane-${randomBytes(16).toString("hex")}`,
      tmuxPaneId: tmuxPane.paneId,
      tmuxServerId: paneServerId,
      agentSessionId: adoptedSession?.id ?? null,
      agentExecutionId: adoptedSession ? tmuxPane.agentdExecutionId : null,
      sessionName: tmuxPane.sessionName,
      windowId: tmuxPane.windowId,
      kind,
      name,
      cwd: tmuxPane.cwd,
      workspaceId: existing?.workspaceId ?? adoptedSession?.workspaceId ?? null,
      agentId,
      runId: kind === "agent" ? tmuxPane.agentdRunId ?? existing?.runId ?? null : tmuxPane.agentdKind === "shell" ? tmuxPane.agentdRunId ?? existing?.runId ?? null : null,
      state,
      title: tmuxPane.title || null,
      lastSeenAt: now,
      windowName: tmuxPane.windowName,
      windowIndex: tmuxPane.windowIndex,
      paneIndex: tmuxPane.paneIndex,
      left: tmuxPane.left,
      top: tmuxPane.top,
      width: tmuxPane.width,
      height: tmuxPane.height,
      windowWidth: tmuxPane.windowWidth,
      windowHeight: tmuxPane.windowHeight,
    };
    await repository.upsert(record);
    // Geometry and pane indexes are live tmux state rather than durable
    // identity. Return the live record so the API/UI never loses it during
    // the same reconciliation pass.
    records.push(record);
  }

  return records;
}

async function adoptAgentSession(
  tmux: TmuxAdapter,
  paneRepository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
  request: { agentSessionId: string; tmuxPaneId: string; executionId: string },
): Promise<void> {
  const session = await agentSessionRepository.findById(request.agentSessionId);
  if (!session) throw controlFailure("agent_session_not_found", `agent session not found: ${request.agentSessionId}`);
  if (session.executionId !== request.executionId) throw controlFailure("agent_execution_mismatch", "agent execution is no longer current");
  const live = tmux.listPanesSnapshot();
  if (!live.available) throw controlFailure("tmux_unavailable", "tmux is unavailable");
  const pane = live.panes.find((candidate) => candidate.paneId === request.tmuxPaneId);
  if (!pane) throw controlFailure("tmux_pane_not_found", `tmux pane not found: ${request.tmuxPaneId}`);
  tmux.setAgentExecutionMetadata(pane.paneId, session.id, request.executionId);
  await syncPanes(tmux, paneRepository, agentSessionRepository, tmux.listPanesSnapshot());
}

async function releaseAgentSession(
  tmux: TmuxAdapter,
  paneRepository: PaneRepository,
  agentSessionRepository: AgentSessionRepository,
  request: { agentSessionId: string; tmuxPaneId: string; executionId: string },
): Promise<void> {
  const live = tmux.listPanesSnapshot();
  if (!live.available) return;
  const pane = live.panes.find((candidate) => candidate.paneId === request.tmuxPaneId);
  if (!pane) return;
  if (pane.agentdSessionId === request.agentSessionId && pane.agentdExecutionId === request.executionId) {
    if (!tmux.clearAgentExecutionMetadata(pane.paneId, request.executionId)) return;
    tmux.resetAgentPaneMetadata(pane.paneId);
    await syncPanes(tmux, paneRepository, agentSessionRepository, tmux.listPanesSnapshot());
  }
}

function controlFailure(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function summarizeSessions(panes: PaneRecord[]): TmuxSession[] {
  const groups = new Map<string, PaneRecord[]>();
  for (const pane of panes) groups.set(pane.sessionName, [...(groups.get(pane.sessionName) ?? []), pane]);

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, sessionPanes]) => {
    const agents = sessionPanes.filter((pane) => pane.kind === "agent").length;
    const shells = sessionPanes.filter((pane) => pane.kind === "shell").length;
    const waitingCount = sessionPanes.filter((pane) => pane.state === "waiting_input" || pane.state === "waiting_approval").length;
    const cwd = sessionPanes[0]?.cwd ?? process.cwd();
    const detailParts = [`${agents} agent${agents === 1 ? "" : "s"}`, `${shells} shell${shells === 1 ? "" : "s"}`];
    if (waitingCount) detailParts.push(`${waitingCount} waiting`);
    return {
      name,
      workspace: basename(cwd) || name,
      cwd: displayCwd(cwd),
      paneCount: sessionPanes.length,
      waitingCount,
      detail: detailParts.join(" · "),
      state: "active",
    } satisfies TmuxSession;
  });
}

function resolvePaneKind(tmuxPane: TmuxPane, existing: PaneRecord | undefined, adopted: boolean, staleAgentMetadata: boolean): PaneRecord["kind"] {
  if (staleAgentMetadata) return "shell";
  if (tmuxPane.agentdKind === "agent" && adopted) return "agent";
  if (tmuxPane.agentdKind === "agent" && !tmuxPane.agentdSessionId && !tmuxPane.agentdRunId) return "agent";
  if (tmuxPane.agentdKind === "shell" || tmuxPane.agentdKind === "unknown") return tmuxPane.agentdKind;
  const detected = paneKindForCommand(tmuxPane.command);
  if (detected === "unknown" && existing?.kind === "agent" && adopted) return "agent";
  return detected;
}

function inferAgentState(tmux: TmuxAdapter, pane: TmuxPane, fallback: PaneRecord["state"]): PaneRecord["state"] {
  let output = "";
  try {
    output = stripAnsi(tmux.capturePane(pane.paneId));
  } catch {
    return fallback;
  }
  const recent = output.slice(-8_000).toLowerCase();
  if (/waiting\s+(for\s+)?(approval|permission)|approve|allow this|apply this|do you want/.test(recent)) return "waiting_approval";
  if (/waiting\s+(for\s+)?input|continue with|press (enter|return)|what should i do|\?\s*[▌_>]?\s*$/.test(recent)) return "waiting_input";
  return "running";
}

function executableName(command: string): string | null {
  const executable = command.trim().split(/\s+/, 1)[0]?.split("/").at(-1)?.toLowerCase();
  return executable === "codex" || executable === "claude" ? executable : null;
}

function isManagedAgentCommand(command: string, backend: "codex" | "claude", agentCommand: string): boolean {
  const executable = command.trim().split(/\s+/, 1)[0]?.split("/").at(-1)?.toLowerCase();
  const configuredAgent = (process.env.AGENTD_AGENT_COMMAND ?? "agent").trim().split(/\s+/, 1)[0]?.split("/").at(-1)?.toLowerCase();
  const resolvedAgent = agentCommand.trim().split(/\s+/, 1)[0]?.split("/").at(-1)?.toLowerCase();
  const sourceLauncher = agentCommand.trim().endsWith(".ts");
  return executable === "agent"
    || executable === configuredAgent
    || executable === resolvedAgent
    || executable === backend
    || (sourceLauncher && executable === "bun");
}

function isLiveAgentExecution(session: Pick<AgentSessionRecord, "status" | "executionPid">): boolean {
  if (session.status !== "running" && session.status !== "resuming") return false;
  if (session.executionPid === null || session.executionPid === undefined) return false;
  try {
    process.kill(session.executionPid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function agentCommand(input: CreatePaneRequest, workspace?: WorkspaceRecord): string {
  const binary = resolveAgentCommand();
  const args = [binary, "run", input.agentId!, "--no-worktree", "--name", input.name];
  if (input.useWorktree) {
    args.splice(3, 1, "--worktree");
    if (workspace?.setupScriptPath) args.push("--setup-hook", workspace.setupScriptPath);
    if (workspace?.cleanupScriptPath) args.push("--cleanup-hook", workspace.cleanupScriptPath);
  }
  return args.map(shellQuote).join(" ");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
}

function displayCwd(cwd: string): string {
  const home = homedir();
  return cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
