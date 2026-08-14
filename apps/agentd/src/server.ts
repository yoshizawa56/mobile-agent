import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { hostname, homedir, platform } from "node:os";
import { basename } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import { paneKindForCommand, type AgentSessionRecord, type PaneRecord, type WorkspaceRecord } from "@mobile-agent/domain";
import type { CreatePaneRequest, PaneSummary, TmuxSession, TerminalEndpoint } from "@mobile-agent/protocol";
import { AuthStore, createAgentDatabase, defaultAgentDatabaseFile, DrizzleAgentSessionRepository, DrizzlePaneRepository, DrizzleWorkspaceRepository } from "@mobile-agent/persistence";
import { AgentdControlServer } from "./auth/control.js";
import { AuthService, type AuthContext } from "./auth/service.js";
import { AgentdEventHub } from "./events.js";
import { AgentdHttpError, createAgentdApp } from "./http/app.js";
import { TerminalSession, TerminalSessionRegistry } from "./terminal-session.js";
import { TmuxAdapter, type TmuxPane } from "./tmux.js";
import { defaultPaneCleanupIntervalMs, defaultPaneRetentionMs, defaultTmuxPollIntervalMs, TmuxStateMonitor } from "./tmux-state.js";
import { TmuxViewportManager } from "./viewport-manager.js";
import { allowedRootsFromEnvironment, WorkspaceSelectionCatalog } from "./workspace-selection.js";

export type AgentdOptions = {
  host: string;
  port: number;
  databaseFile?: string;
  corsOrigin?: string;
  allowedRoots?: string[];
  controlSocket?: string;
  webOrigin?: string;
  agentdBaseUrl?: string;
  tmuxPollIntervalMs?: number;
  paneCleanupIntervalMs?: number;
  paneRetentionMs?: number;
};

export type { AgentdApp } from "./http/app.js";
export { AgentdHttpError, createAgentdApp } from "./http/app.js";

export function createAgentdServer(options: AgentdOptions) {
  const tmux = new TmuxAdapter();
  const viewportManager = new TmuxViewportManager(tmux);
  const databaseFile = options.databaseFile ?? defaultDatabaseFile();
  const database = createAgentDatabase(databaseFile);
  const agentSessionRepository = new DrizzleAgentSessionRepository(database.db);
  const paneRepository = new DrizzlePaneRepository(database.db);
  const workspaceRepository = new DrizzleWorkspaceRepository(database.db);
  const workspaceCatalog = new WorkspaceSelectionCatalog(options.allowedRoots ?? allowedRootsFromEnvironment());
  const eventHub = new AgentdEventHub();
  const hookToken = randomBytes(24).toString("hex");
  const defaultTarget = process.env.AGENTD_DEFAULT_TMUX_TARGET ?? "agentd";
  const webOrigin = options.webOrigin ?? process.env.AGENTD_WEB_ORIGIN ?? "http://localhost:5173";
  const corsOrigin = options.corsOrigin ?? process.env.AGENTD_CORS_ORIGIN ?? webOrigin;
  const auth = new AuthService({
    store: new AuthStore(database.sqlite),
    webOrigin,
    agentdBaseUrl: options.agentdBaseUrl ?? process.env.AGENTD_PAIRING_BASE_URL ?? `http://127.0.0.1:${options.port}`,
  });
  const controlSocket = options.controlSocket ?? process.env.AGENTD_CONTROL_SOCKET ?? `${databaseFile === ":memory:" ? `${homedir()}/.local/state/mobile-agent/agentd` : databaseFile}.control.sock`;
  const controlServer = new AgentdControlServer({
    socketPath: controlSocket,
    auth,
    adoptAgentSession: (request) => adoptAgentSession(tmux, paneRepository, agentSessionRepository, request),
    releaseAgentSession: (request) => releaseAgentSession(tmux, paneRepository, agentSessionRepository, request),
  });
  const tmuxPollIntervalMs = durationOption(options.tmuxPollIntervalMs, "AGENTD_TMUX_POLL_INTERVAL_MS", defaultTmuxPollIntervalMs, 1);
  const paneCleanupIntervalMs = durationOption(options.paneCleanupIntervalMs, "AGENTD_PANE_CLEANUP_INTERVAL_MS", defaultPaneCleanupIntervalMs, 1);
  const paneRetentionMs = durationOption(options.paneRetentionMs, "AGENTD_PANE_RETENTION_MS", defaultPaneRetentionMs, 0);
  let eventRevision = 0;
  const tmuxStateMonitor = new TmuxStateMonitor({
    readPanes: () => tmux.listPanesSnapshot(),
    synchronize: (snapshot) => syncPanes(tmux, paneRepository, agentSessionRepository, snapshot).then((records) => records.map((record) => record.id)),
    cleanup: (activePaneIds, olderThan, tmuxServerScope) => paneRepository.pruneStalePanes(activePaneIds, olderThan, tmuxServerScope).then(() => undefined),
    onChange: (changes) => {
      const revision = ++eventRevision;
      for (const change of changes) {
        eventHub.publish({
          type: "session_updated",
          sessionName: change.sessionName,
          reason: change.reason,
          revision,
        });
      }
    },
    intervalMs: tmuxPollIntervalMs,
    cleanupIntervalMs: paneCleanupIntervalMs,
    paneRetentionMs,
  });

  const app = createAgentdApp({
    auth,
    corsOrigin,
    hookToken,
    getTerminal: getLocalTerminal,
    listWorkspaceDirectories: async () => (await workspaceRepository.list()).map((workspace) => workspaceCatalog.toDirectoryOption(workspace)),
    browseWorkspaceDirectories: (parentPath) => workspaceCatalog.browseDirectories(parentPath),
    registerWorkspace: async (input) => {
      const candidate = workspaceCatalog.registerWorkspace(input);
      const existing = await workspaceRepository.findById(candidate.id);
      const workspace = workspaceCatalog.registerWorkspace(input, existing);
      await workspaceRepository.upsert(workspace);
      return workspaceCatalog.toDirectoryOption(workspace);
    },
    resolveWorkspaceDirectory: (workspaceId) => workspaceCatalog.resolveWorkspaceDirectory(workspaceId, (id) => workspaceRepository.findById(id)),
    resolveWorkspaceSelection: (selection) => workspaceCatalog.resolveSelection(selection, (id) => workspaceRepository.findById(id)),
    listSessions: () => listSessions(tmux, paneRepository, agentSessionRepository),
    createSession: (input) => createSession(input, tmux, paneRepository, agentSessionRepository, workspaceCatalog),
    listPanes: (sessionName) => listCurrentPanes(tmux, paneRepository, agentSessionRepository, sessionName),
    createPane: (input, workspace) => createPane(input, tmux, paneRepository, agentSessionRepository, viewportManager, workspaceCatalog, workspace),
    handleTmuxHook: (event, client) => viewportManager.handleTmuxHook(event, client),
  });

  const httpServer = createServer(getRequestListener(app.fetch));
  const webSocketServer = new WebSocketServer({ noServer: true });
  const eventWebSocketServer = new WebSocketServer({ noServer: true });
  const terminalSessions = new TerminalSessionRegistry();

  webSocketServer.on("connection", (socket: WebSocket, _request: IncomingMessage, context: AuthContext) => {
    auth.trackSocket(context, socket);
    new TerminalSession(socket, {
      cwd: process.cwd(),
      defaultTarget,
      viewportManager,
      sessions: terminalSessions,
      authDeviceId: context.deviceId,
    });
  });

  eventWebSocketServer.on("connection", (socket: WebSocket, _request: IncomingMessage, context: AuthContext) => {
    auth.trackSocket(context, socket);
    eventHub.add(socket);
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://agentd.local");
    const pathname = requestUrl.pathname;
    if (!auth.allowsWebOrigin(request.headers.origin)) {
      rejectUpgrade(socket);
      return;
    }
    if (pathname === "/events") {
      const context = auth.consumeWebSocketTicket(requestUrl.searchParams.get("ticket") ?? undefined, "events");
      if (!context) {
        rejectUpgrade(socket);
        return;
      }
      eventWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        eventWebSocketServer.emit("connection", webSocket, request, context);
      });
      return;
    }
    if (pathname !== "/terminal") {
      socket.destroy();
      return;
    }

    const context = auth.consumeWebSocketTicket(requestUrl.searchParams.get("ticket") ?? undefined, "terminal");
    if (!context) {
      rejectUpgrade(socket);
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request, context);
    });
  });

  return {
    app,
    start(): Promise<void> {
      return new Promise((resolveStart, rejectStart) => {
        const onError = (error: Error) => {
          httpServer.removeListener("listening", onListening);
          rejectStart(error);
        };
        const onListening = () => {
          httpServer.removeListener("error", onError);
          tmuxStateMonitor.start();
          viewportManager.configureHooks(`http://127.0.0.1:${options.port}/internal/tmux-hook`, hookToken);
          controlServer.start();
          console.log(`agentd listening on http://${options.host}:${options.port}`);
          resolveStart();
        };

        httpServer.once("error", onError);
        httpServer.once("listening", onListening);

        try {
          tmux.ensureSession(defaultTarget, process.cwd());
        } catch (error) {
          console.warn(`agentd could not prepare default tmux session: ${error instanceof Error ? error.message : String(error)}`);
        }

        httpServer.listen(options.port, options.host);
      });
    },
    stop() {
      tmuxStateMonitor.stop();
      terminalSessions.closeAll();
      viewportManager.dispose();
      webSocketServer.close();
      eventWebSocketServer.close();
      eventHub.close();
      controlServer.stop();
      if (httpServer.listening) httpServer.close();
      database.close();
    },
  };
}

async function getLocalTerminal(): Promise<TerminalEndpoint> {
  const host = hostname();
  return {
    id: host,
    name: displayHostName(host),
    host,
    tailnetIp: tailscaleIp() ?? host,
    state: "online",
    detail: `agentd · ${platform()}`,
    lastSeen: "online now",
  };
}

async function listSessions(
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
): Promise<TmuxSession[]> {
  const panes = await syncPanes(tmux, paneRepository, agentSessionRepository);
  return summarizeSessions(panes);
}

async function createSession(
  input: { name: string; cwd: string; workspaceId?: string },
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
  workspaceCatalog: WorkspaceSelectionCatalog,
): Promise<TmuxSession> {
  const cwd = await workspaceCatalog.resolveLegacyDirectory(input.cwd);
  if (tmux.hasSession(input.name)) {
    throw new AgentdHttpError(409, "session_exists", `tmux session already exists: ${input.name}`);
  }

  tmux.createSession(input.name, cwd);
  const panes = await syncPanes(tmux, paneRepository, agentSessionRepository);
  const session = summarizeSessions(panes.filter((pane) => pane.sessionName === input.name)).find((candidate) => candidate.name === input.name);
  if (!session || !panes.some((pane) => pane.sessionName === input.name)) {
    throw new AgentdHttpError(503, "session_not_visible", "tmux created the session but agentd could not read it");
  }
  return session;
}

async function listCurrentPanes(
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
  sessionName?: string,
): Promise<PaneRecord[]> {
  const panes = await syncPanes(tmux, paneRepository, agentSessionRepository);
  return sessionName ? panes.filter((pane) => pane.sessionName === sessionName) : panes;
}

async function createPane(
  input: CreatePaneRequest,
  tmux: TmuxAdapter,
  repository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
  viewportManager: TmuxViewportManager,
  workspaceCatalog: WorkspaceSelectionCatalog,
  workspace?: WorkspaceRecord,
): Promise<PaneSummary> {
  if (!tmux.hasSession(input.sessionName)) {
    throw new AgentdHttpError(404, "session_not_found", `tmux session does not exist: ${input.sessionName}`);
  }
  if (input.kind === "agent" && !input.agentId) {
    throw new AgentdHttpError(400, "agent_required", "agentId is required for an agent pane");
  }
  if (input.kind === "shell" && input.agentId) {
    throw new AgentdHttpError(400, "agent_not_allowed", "agentId is not allowed for a shell pane");
  }

  if (!input.cwd) {
    throw new AgentdHttpError(400, "invalid_directory", "A workspace directory is required");
  }
  const cwd = await workspaceCatalog.resolveLegacyDirectory(input.cwd);

  const command = input.kind === "agent" ? agentCommand(input, workspace) : undefined;
  const tmuxPaneId = input.placement === "window"
    ? tmux.newWindow(input.sessionName, cwd, command)
    : createSplitPane(input, tmux, cwd, command);
  if (input.placement !== "window" && input.targetPaneId) {
    viewportManager.reassertMobileViewport(input.targetPaneId);
  }
  const panes = await syncPanes(tmux, repository, agentSessionRepository);
  const current = panes.find((pane) => pane.tmuxPaneId === tmuxPaneId);
  if (!current) {
    throw new AgentdHttpError(503, "pane_not_visible", "tmux created the pane but agentd could not read it");
  }

  const record: PaneSummary = {
    ...current,
    kind: input.kind,
    name: input.name,
    workspaceId: input.workspaceId ?? current.workspaceId,
    agentId: input.agentId,
    state: input.kind === "agent" ? "starting" : "running",
  };
  await repository.upsert(record);
  tmux.setAgentPaneMetadata(tmuxPaneId, "pane_id", record.id);
  tmux.setAgentPaneMetadata(tmuxPaneId, "pane_name", input.name);
  tmux.setAgentPaneMetadata(tmuxPaneId, "agent_id", input.agentId ?? "");
  tmux.setAgentPaneMetadata(tmuxPaneId, "kind", input.kind);
  tmux.setAgentPaneMetadata(tmuxPaneId, "workspace_id", input.workspaceId ?? "");
  return record;
}

function createSplitPane(input: CreatePaneRequest, tmux: TmuxAdapter, cwd: string, command: string | undefined): string {
  if (input.placement === "window") {
    throw new AgentdHttpError(400, "split_placement_required", "A split placement is required");
  }
  if (!input.targetPaneId) {
    throw new AgentdHttpError(400, "target_pane_required", "targetPaneId is required for a split pane");
  }

  const target = tmux.resolvePane(input.targetPaneId);
  const windowSnapshot = tmux.snapshotWindow(target);
  if (target.sessionName !== input.sessionName) {
    throw new AgentdHttpError(400, "target_pane_session_mismatch", "targetPaneId belongs to a different tmux session");
  }

  return tmux.splitWindow(cwd, command, input.placement, input.targetPaneId, windowSnapshot.zoomed);
}

async function syncPanes(
  tmux: TmuxAdapter,
  repository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
  live = tmux.listPanesSnapshot(),
): Promise<PaneRecord[]> {
  const now = new Date().toISOString();
  const records: PaneRecord[] = [];
  const tmuxServerId = live.tmuxServerId ?? "legacy";

  for (const tmuxPane of live.panes) {
    const paneServerId = tmuxPane.tmuxServerId ?? tmuxServerId;
    const existing = await repository.findByTmuxPaneIdentity(paneServerId, tmuxPane.paneId);
    const sessionCandidate = tmuxPane.agentdSessionId ? await agentSessionRepository.findById(tmuxPane.agentdSessionId) : undefined;
    const adoptedSession = sessionCandidate
      && tmuxPane.agentdExecutionId === sessionCandidate.executionId
      && isLiveAgentExecution(sessionCandidate)
      && isManagedAgentCommand(tmuxPane.command, sessionCandidate.backend)
      ? sessionCandidate
      : undefined;
    if (tmuxPane.agentdSessionId && !adoptedSession) {
      try {
        tmux.clearAgentSessionMetadata(tmuxPane.paneId, tmuxPane.agentdExecutionId ?? "");
      } catch {
        // The pane may disappear while stale adoption metadata is being cleared.
      }
    }
    const metadataId = tmuxPane.agentdPaneId;
    const conflictingId = !existing && metadataId ? await repository.findById(metadataId) : undefined;
    const reusableMetadataId = metadataId && (!conflictingId || (conflictingId.tmuxServerId === paneServerId && conflictingId.tmuxPaneId === tmuxPane.paneId))
      ? metadataId
      : undefined;
    const kind = resolvePaneKind(tmuxPane, existing);
    const agentId = kind === "agent" ? tmuxPane.agentdAgentId ?? adoptedSession?.backend ?? executableName(tmuxPane.command) ?? existing?.agentId ?? "agent" : null;
    const state = kind === "agent" ? inferAgentState(tmux, tmuxPane, existing?.state ?? "running") : "running";
    const record: PaneRecord = {
      id: existing?.id ?? reusableMetadataId ?? `pane-${randomBytes(16).toString("hex")}`,
      tmuxPaneId: tmuxPane.paneId,
      tmuxServerId: paneServerId,
      agentSessionId: adoptedSession?.id ?? null,
      agentExecutionId: adoptedSession ? tmuxPane.agentdExecutionId : null,
      sessionName: tmuxPane.sessionName,
      windowId: tmuxPane.windowId,
      kind,
      name: tmuxPane.agentdName ?? adoptedSession?.name ?? (existing?.name && existing.name !== tmuxPane.paneId ? existing.name : tmuxPane.title || tmuxPane.command || tmuxPane.paneId),
      cwd: tmuxPane.cwd,
      workspaceId: existing?.workspaceId ?? adoptedSession?.workspaceId ?? null,
      agentId,
      runId: kind === "agent" ? tmuxPane.agentdRunId ?? existing?.runId ?? null : null,
      state,
      title: tmuxPane.title || null,
      lastSeenAt: now,
      windowName: tmuxPane.windowName,
      windowIndex: tmuxPane.windowIndex,
      left: tmuxPane.left,
      top: tmuxPane.top,
      width: tmuxPane.width,
      height: tmuxPane.height,
      windowWidth: tmuxPane.windowWidth,
      windowHeight: tmuxPane.windowHeight,
    };
    await repository.upsert(record);
    records.push(await repository.findByTmuxPaneIdentity(paneServerId, tmuxPane.paneId) ?? record);
  }

  return records;
}

async function adoptAgentSession(
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
  request: { agentSessionId: string; tmuxPaneId: string; executionId: string },
): Promise<void> {
  const session = await agentSessionRepository.findById(request.agentSessionId);
  if (!session) throw controlFailure("agent_session_not_found", `agent session not found: ${request.agentSessionId}`);
  if (session.executionId !== request.executionId) throw controlFailure("agent_execution_mismatch", "agent execution is no longer current");
  const live = tmux.listPanesSnapshot();
  if (!live.available) throw controlFailure("tmux_unavailable", "tmux is unavailable");
  const pane = live.panes.find((candidate) => candidate.paneId === request.tmuxPaneId);
  if (!pane) throw controlFailure("tmux_pane_not_found", `tmux pane not found: ${request.tmuxPaneId}`);
  tmux.setAgentSessionMetadata(pane.paneId, session.id, request.executionId);
  await syncPanes(tmux, paneRepository, agentSessionRepository, tmux.listPanesSnapshot());
}

async function releaseAgentSession(
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  agentSessionRepository: DrizzleAgentSessionRepository,
  request: { agentSessionId: string; tmuxPaneId: string; executionId: string },
): Promise<void> {
  const live = tmux.listPanesSnapshot();
  if (!live.available) return;
  const pane = live.panes.find((candidate) => candidate.paneId === request.tmuxPaneId);
  if (!pane) return;
  if (pane.agentdSessionId === request.agentSessionId && pane.agentdExecutionId === request.executionId) {
    tmux.clearAgentSessionMetadata(pane.paneId, request.executionId);
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

function resolvePaneKind(tmuxPane: TmuxPane, existing: PaneRecord | undefined): PaneRecord["kind"] {
  if (tmuxPane.agentdKind === "agent" || tmuxPane.agentdKind === "shell" || tmuxPane.agentdKind === "unknown") {
    return tmuxPane.agentdKind;
  }
  const detected = paneKindForCommand(tmuxPane.command);
  if (detected === "unknown" && existing?.kind === "agent") return "agent";
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

function isManagedAgentCommand(command: string, backend: "codex" | "claude"): boolean {
  const executable = command.trim().split(/\s+/, 1)[0]?.split("/").at(-1)?.toLowerCase();
  const configuredAgent = (process.env.AGENTD_AGENT_COMMAND ?? "agent").trim().split(/\s+/, 1)[0]?.split("/").at(-1)?.toLowerCase();
  return executable === "agent" || executable === configuredAgent || executable === backend;
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
  const binary = process.env.AGENTD_AGENT_COMMAND ?? "agent";
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

function displayHostName(host: string): string {
  return host.split(".")[0] || host;
}

function rejectUpgrade(socket: NodeJS.WritableStream & { destroy: () => void; write: (chunk: string) => boolean }): void {
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function tailscaleIp(): string | undefined {
  const result = spawnSync("tailscale", ["ip", "-4"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const address = result.status === 0 ? result.stdout.trim().split("\n")[0] : "";
  return address || undefined;
}

function defaultDatabaseFile(): string {
  return defaultAgentDatabaseFile(process.env);
}

function durationOption(value: number | undefined, environmentName: string, fallback: number, minimum: number): number {
  const configured = value ?? (process.env[environmentName] === undefined ? fallback : Number(process.env[environmentName]));
  if (!Number.isFinite(configured) || !Number.isInteger(configured) || configured < minimum) {
    throw new Error(`${environmentName} must be an integer >= ${minimum}`);
  }
  return configured;
}
