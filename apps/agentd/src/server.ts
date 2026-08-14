import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { hostname, homedir, platform } from "node:os";
import { basename } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import { paneKindForCommand, type AgentSessionRecord, type PaneRecord, type WorkspaceRecord } from "@mobile-agent/domain";
import { createLogger, errorFields, type Logger, type LogLevel } from "@mobile-agent/logging";
import type { CreatePaneRequest, PaneSummary, TmuxSession, TerminalEndpoint } from "@mobile-agent/protocol";
import { AuthStore, createAgentDatabase, DrizzleAgentSessionRepository, DrizzlePaneRepository, DrizzleWorkspaceRepository, resolveAgentdPaths } from "@mobile-agent/persistence";
import { AgentdControlServer } from "./auth/control.js";
import { AuthService, type AuthContext } from "./auth/service.js";
import { AgentdEventHub } from "./events.js";
import { AgentdHttpError, createAgentdApp } from "./http/app.js";
import { TerminalSession, TerminalSessionRegistry } from "./terminal-session.js";
import { buildAgentShellCommand, configureManagedTmuxSession, resolveAgentCommand, TmuxAdapter, type TmuxPane } from "./tmux.js";
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
  logger?: Logger;
  logLevel?: LogLevel;
  logFile?: string;
};

export type { AgentdApp } from "./http/app.js";
export { AgentdHttpError, createAgentdApp } from "./http/app.js";
export { TmuxAdapter } from "./tmux.js";
export type { TmuxPane } from "./tmux.js";

export function createAgentdServer(options: AgentdOptions) {
  const ownsLogger = !options.logger;
  const logger = options.logger ?? createLogger({
    service: "agentd",
    mode: options.logFile ? "background" : "attached",
    level: options.logLevel ?? "info",
    logFile: options.logFile,
    output: process.stderr,
    showStack: options.logLevel === "debug",
  });
  const tmux = new TmuxAdapter();
  const viewportManager = new TmuxViewportManager(tmux);
  const paths = resolveAgentdPaths(process.env, {
    databaseFile: options.databaseFile,
    controlSocket: options.controlSocket,
  });
  const databaseFile = paths.databaseFile;
  const configuredDatabaseFile = options.databaseFile ?? process.env.AGENTD_DB_FILE ?? process.env.AGENT_DATABASE_FILE;
  const usePrivateInstanceDirectory = Boolean(process.env.AGENTD_INSTANCE_DIR?.trim()) || !configuredDatabaseFile?.trim();
  const database = createAgentDatabase(databaseFile, {
    instanceDirectory: databaseFile === ":memory:" || !usePrivateInstanceDirectory ? undefined : paths.instanceDirectory,
  });
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
  const controlServer = new AgentdControlServer({
    socketPath: paths.controlSocket,
    auth,
    adoptAgentSession: (request) => adoptAgentSession(tmux, paneRepository, agentSessionRepository, request),
    releaseAgentSession: (request) => releaseAgentSession(tmux, paneRepository, agentSessionRepository, request),
  });
  let controlReady = false;
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
    isReady: () => controlReady,
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

  const requestListener = getRequestListener(app.fetch);
  const httpServer = createServer((request, response) => {
    const startedAt = Date.now();
    const pathname = request.url ? safeRequestPath(request.url) : "/";
    logger.debug("http.request_started", {
      method: request.method ?? "GET",
      path: pathname,
    });
    response.once("finish", () => {
      logger.debug("http.request_finished", {
        method: request.method ?? "GET",
        path: pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    requestListener(request, response);
  });
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
          logger.error("daemon.start_failed", errorFields(error));
          rejectStart(error);
        };
        const onListening = async () => {
          httpServer.removeListener("error", onError);
          try {
            tmuxStateMonitor.start();
            viewportManager.configureHooks(`http://127.0.0.1:${options.port}/internal/tmux-hook`, hookToken);
            await controlServer.start();
            controlReady = true;
            logger.info("daemon.listening", { host: options.host, port: options.port });
            resolveStart();
          } catch (error) {
            logger.error("daemon.start_failed", errorFields(error));
            rejectStart(error instanceof Error ? error : new Error(String(error)));
          }
        };

        httpServer.once("error", onError);
        httpServer.once("listening", onListening);

        let createdDefaultSession = false;
        try {
          const managedSessionId = randomUUID();
          createdDefaultSession = tmux.ensureSession(
            defaultTarget,
            process.cwd(),
            buildAgentShellCommand(undefined, {
              AGENTD_MANAGED_SESSION_ID: managedSessionId,
              AGENTD_MANAGED_SESSION_NAME: defaultTarget,
            }),
          );
          if (createdDefaultSession) configureManagedTmuxSession(tmux, defaultTarget, managedSessionId);
        } catch (error) {
          if (createdDefaultSession) {
            try {
              tmux.killSession(defaultTarget);
            } catch {
              // Preserve the warning; cleanup is best effort.
            }
          }
          logger.warn("tmux.default_session_failed", errorFields(error));
        }

        httpServer.listen(options.port, options.host);
      });
    },
    stop() {
      controlReady = false;
      logger.info("daemon.stopping");
      tmuxStateMonitor.stop();
      terminalSessions.closeAll();
      viewportManager.dispose();
      webSocketServer.close();
      eventWebSocketServer.close();
      eventHub.close();
      controlServer.stop();
      if (httpServer.listening) httpServer.close();
      database.close();
      if (ownsLogger) logger.close();
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
      throw new AgentdHttpError(503, "session_not_visible", "tmux created the session but agentd could not read it");
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

  const command = buildAgentShellCommand(
    resolveAgentCommand(),
    { AGENTD_MANAGED_SESSION_NAME: input.sessionName, AGENTD_PANE_NAME: input.name },
    input.kind === "agent" ? agentCommand(input, workspace) : undefined,
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
  tmux.setAgentExecutionMetadata(pane.paneId, session.id, request.executionId);
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

function displayHostName(host: string): string {
  return host.split(".")[0] || host;
}

function safeRequestPath(url: string): string {
  try {
    return new URL(url, "http://agentd.local").pathname;
  } catch {
    return "<invalid>";
  }
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

function durationOption(value: number | undefined, environmentName: string, fallback: number, minimum: number): number {
  const configured = value ?? (process.env[environmentName] === undefined ? fallback : Number(process.env[environmentName]));
  if (!Number.isFinite(configured) || !Number.isInteger(configured) || configured < minimum) {
    throw new Error(`${environmentName} must be an integer >= ${minimum}`);
  }
  return configured;
}
