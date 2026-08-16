import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isIP } from "node:net";
import { hostname, platform } from "node:os";
import { agentdWebsocket, createAgentdApp, type AgentdSocket } from "@mobile-agent/agentd-http";
import { WorkspaceCrud } from "@mobile-agent/application";
import { createLogger, errorFields, type Logger, type LogLevel } from "@mobile-agent/logging";
import type { TerminalEndpoint } from "@mobile-agent/protocol";
import { AuthStore, createAgentDatabase, DrizzleAgentSessionRepository, DrizzlePaneRepository, DrizzleWorkspaceRepository, recordAuditEvent, resolveAgentdPaths } from "@mobile-agent/persistence";
import { buildTailscaleInvocation } from "@mobile-agent/tailscale";
import { AgentdControlServer } from "./auth/control.js";
import { AuthService } from "./auth/service.js";
import { createAgentdApplication } from "./application/agentd.js";
import { AgentdEventHub } from "./events.js";
import { createImagePaster } from "./image-paste.js";
import { TerminalSession, TerminalSessionRegistry } from "./terminal-session.js";
import { buildAgentShellCommand, configureManagedTmuxSession, TmuxAdapter } from "./tmux.js";
import { defaultPaneCleanupIntervalMs, defaultPaneRetentionMs, defaultTmuxPollIntervalMs, TmuxStateMonitor } from "./tmux-state.js";
import { TmuxViewportManager } from "./viewport-manager.js";
import { allowedRootsFromEnvironment, WorkspaceSelectionCatalog } from "./workspace-selection.js";

export type AgentdOptions = {
  host: string;
  port: number;
  databaseFile?: string;
  allowedRoots?: string[];
  controlSocket?: string;
  agentdBaseUrl?: string;
  tmuxPollIntervalMs?: number;
  paneCleanupIntervalMs?: number;
  paneRetentionMs?: number;
  logger?: Logger;
  logLevel?: LogLevel;
  logFile?: string;
};

export type { AgentdApp } from "@mobile-agent/agentd-http";
export { AgentdHttpError, createAgentdApp } from "@mobile-agent/agentd-http";
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
  const workspaceCrud = new WorkspaceCrud(workspaceRepository, workspaceCatalog, {
    audit: {
      record: (eventType, entityId, payload) => recordAuditEvent(database.db, { eventType, entityId, payload }),
    },
  });
  const application = createAgentdApplication({
    getTerminal: getLocalTerminal,
    tmux,
    paneRepository,
    agentSessionRepository,
    workspaceCatalog,
    workspaceRepository,
    workspaceCrud,
    viewportManager,
  });
  const eventHub = new AgentdEventHub();
  const hookToken = randomBytes(24).toString("hex");
  const defaultTarget = process.env.AGENTD_DEFAULT_TMUX_TARGET ?? "agentd";
  const auth = new AuthService({
    store: new AuthStore(database.sqlite),
    agentdBaseUrl: options.agentdBaseUrl ?? process.env.AGENTD_PAIRING_BASE_URL ?? `http://127.0.0.1:${options.port}`,
  });
  const controlServer = new AgentdControlServer({
    socketPath: paths.controlSocket,
    auth,
    adoptAgentSession: (request) => application.adoptAgentSession(request),
    observeAgentSession: (request) => application.observeAgentSession(request),
    releaseAgentSession: (request) => application.releaseAgentSession(request),
  });
  let controlReady = false;
  const tmuxPollIntervalMs = durationOption(options.tmuxPollIntervalMs, "AGENTD_TMUX_POLL_INTERVAL_MS", defaultTmuxPollIntervalMs, 1);
  const paneCleanupIntervalMs = durationOption(options.paneCleanupIntervalMs, "AGENTD_PANE_CLEANUP_INTERVAL_MS", defaultPaneCleanupIntervalMs, 1);
  const paneRetentionMs = durationOption(options.paneRetentionMs, "AGENTD_PANE_RETENTION_MS", defaultPaneRetentionMs, 0);
  let eventRevision = 0;
  const tmuxStateMonitor = new TmuxStateMonitor({
    readPanes: () => tmux.listPanesSnapshot(),
    synchronize: (snapshot) => application.reconcile(snapshot).then((records) => ({
      activePaneIds: records.map((record) => record.id),
      paneStates: new Map(records.map((record) => [record.tmuxPaneId, record.state])),
      paneRecentOutputs: new Map(records.map((record) => [record.tmuxPaneId, record.recentOutput])),
    })),
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

  const terminalSessions = new TerminalSessionRegistry();
  const imagePaster = createImagePaster({ tmux });
  const app = createAgentdApp({
    auth,
    application,
    isReady: () => controlReady,
    corsOrigin: "*",
    hookToken,
    onTerminalConnection: (socket: AgentdSocket, context) => {
      auth.trackSocket(context, socket);
      new TerminalSession(socket, {
        cwd: process.cwd(),
        defaultTarget,
        viewportManager,
        sessions: terminalSessions,
        authDeviceId: context.deviceId,
        imagePaster,
      });
    },
    onEventsConnection: (socket: AgentdSocket, context) => {
      auth.trackSocket(context, socket);
      eventHub.add(socket);
    },
    logger,
  });
  let httpServer: ReturnType<typeof Bun.serve> | undefined;

  return {
    app,
    async start(): Promise<void> {
      if (httpServer) return;

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

      try {
        httpServer = Bun.serve({
          hostname: options.host,
          port: options.port,
          fetch: app.fetch,
          websocket: agentdWebsocket,
        });
        tmuxStateMonitor.start();
        viewportManager.configureHooks(`http://127.0.0.1:${httpServer.port}/internal/tmux-hook`, hookToken);
        await controlServer.start();
        controlReady = true;
        logger.info("daemon.listening", { host: options.host, port: httpServer.port });
      } catch (error) {
        controlReady = false;
        tmuxStateMonitor.stop();
        controlServer.stop();
        httpServer?.stop(true);
        httpServer = undefined;
        const failure = error instanceof Error ? error : new Error(String(error));
        logger.error("daemon.start_failed", errorFields(failure));
        throw failure;
      }
    },
    stop() {
      controlReady = false;
      logger.info("daemon.stopping");
      tmuxStateMonitor.stop();
      terminalSessions.closeAll();
      viewportManager.dispose();
      eventHub.close();
      controlServer.stop();
      httpServer?.stop(true);
      httpServer = undefined;
      database.close();
      if (ownsLogger) logger.close();
    },
  };
}

async function getLocalTerminal(): Promise<TerminalEndpoint> {
  const host = hostname();
  return {
    id: host,
    name: host.split(".")[0] || host,
    host,
    tailnetIp: tailscaleIp() ?? host,
    state: "online",
    detail: `agentd · ${platform()}`,
    lastSeen: "online now",
  };
}

function tailscaleIp(): string | undefined {
  const invocation = buildTailscaleInvocation(process.env.TAILSCALE_BIN ?? "tailscale", ["ip", "-4"], process.env, process.platform, {
    allowShellFallback: false,
  });
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: invocation.environment,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 500,
  });
  const address = result.status === 0 ? result.stdout.trim().split("\n")[0] : "";
  return isIP(address) === 4 ? address : undefined;
}

function durationOption(value: number | undefined, environmentName: string, fallback: number, minimum: number): number {
  const configured = value ?? (process.env[environmentName] === undefined ? fallback : Number(process.env[environmentName]));
  if (!Number.isFinite(configured) || !Number.isInteger(configured) || configured < minimum) {
    throw new Error(`${environmentName} must be an integer >= ${minimum}`);
  }
  return configured;
}
