import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { hostname, homedir, platform } from "node:os";
import { basename } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { paneKindForCommand, type PaneRecord } from "@mobile-agent/domain";
import type { CreatePaneRequest, PaneSummary, TmuxSession, TerminalEndpoint } from "@mobile-agent/protocol";
import { createAgentDatabase, defaultAgentDatabaseFile, DrizzlePaneRepository, DrizzleProjectRepository } from "@mobile-agent/persistence";
import { AgentdEventHub } from "./events.js";
import { AgentdHttpError, createAgentdApp } from "./http/app.js";
import { TerminalSession } from "./terminal-session.js";
import { TmuxAdapter, type TmuxPane } from "./tmux.js";
import { TmuxStateMonitor } from "./tmux-state.js";
import { TmuxViewportManager } from "./viewport-manager.js";
import { allowedRootsFromEnvironment, projectOptionsFromDirectory, WorkspaceSelectionCatalog } from "./workspace-selection.js";

export type AgentdOptions = {
  host: string;
  port: number;
  databaseFile?: string;
  corsOrigin?: string;
  allowedRoots?: string[];
};

export type { AgentdApp } from "./http/app.js";
export { AgentdHttpError, createAgentdApp } from "./http/app.js";

export function createAgentdServer(options: AgentdOptions) {
  const tmux = new TmuxAdapter();
  const viewportManager = new TmuxViewportManager(tmux);
  const database = createAgentDatabase(options.databaseFile ?? defaultDatabaseFile());
  const paneRepository = new DrizzlePaneRepository(database.db);
  const projectRepository = new DrizzleProjectRepository(database.db);
  const workspaceCatalog = new WorkspaceSelectionCatalog({
    allowedRoots: options.allowedRoots ?? allowedRootsFromEnvironment(),
    listProjects: async () => {
      const projects = [...projectOptionsFromDirectory(), ...(await projectRepository.list()).map((project) => ({
        id: project.id,
        name: project.name,
        directory: project.directory,
      }))];
      return [...new Map(projects.map((project) => [project.name, project])).values()];
    },
  });
  const eventHub = new AgentdEventHub();
  const hookToken = randomBytes(24).toString("hex");
  const defaultTarget = process.env.AGENTD_DEFAULT_TMUX_TARGET ?? "agentd";
  const corsOrigin = options.corsOrigin ?? process.env.AGENTD_CORS_ORIGIN ?? "*";
  let eventRevision = 0;
  const tmuxStateMonitor = new TmuxStateMonitor({
    readPanes: () => tmux.listPanes(),
    synchronize: (panes) => syncPanes(tmux, paneRepository, panes).then(() => undefined),
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
  });

  const app = createAgentdApp({
    corsOrigin,
    hookToken,
    getTerminal: getLocalTerminal,
    listWorkspaceDirectories: () => workspaceCatalog.listDirectories(),
    listProjects: () => workspaceCatalog.listProjects(),
    resolveWorkspaceDirectory: (workspaceId) => workspaceCatalog.resolveWorkspaceDirectory(workspaceId),
    resolveWorkspaceSelection: (selection) => workspaceCatalog.resolveSelection(selection),
    listSessions: () => listSessions(tmux, paneRepository),
    createSession: (input) => createSession(input, tmux, paneRepository, workspaceCatalog),
    listPanes: (sessionName) => listCurrentPanes(tmux, paneRepository, sessionName),
    createPane: (input) => createPane(input, tmux, paneRepository, viewportManager, workspaceCatalog),
    handleTmuxHook: (event, client) => viewportManager.handleTmuxHook(event, client),
  });

  const httpServer = createServer(getRequestListener(app.fetch));
  const webSocketServer = new WebSocketServer({ noServer: true });
  const eventWebSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on("connection", (socket) => {
    new TerminalSession(socket, {
      cwd: process.cwd(),
      defaultTarget,
      viewportManager,
    });
  });

  eventWebSocketServer.on("connection", (socket) => {
    eventHub.add(socket);
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://agentd.local").pathname;
    if (pathname === "/events") {
      eventWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        eventWebSocketServer.emit("connection", webSocket, request);
      });
      return;
    }
    if (pathname !== "/terminal") {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  return {
    app,
    start() {
      try {
        tmux.ensureSession(defaultTarget, process.cwd());
      } catch (error) {
        console.warn(`agentd could not prepare default tmux session: ${error instanceof Error ? error.message : String(error)}`);
      }

      httpServer.listen(options.port, options.host, () => {
        tmuxStateMonitor.start();
        viewportManager.configureHooks(`http://127.0.0.1:${options.port}/internal/tmux-hook`, hookToken);
        console.log(`agentd listening on http://${options.host}:${options.port}`);
      });
    },
    stop() {
      tmuxStateMonitor.stop();
      viewportManager.dispose();
      webSocketServer.close();
      eventWebSocketServer.close();
      eventHub.close();
      httpServer.close();
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
): Promise<TmuxSession[]> {
  const panes = await syncPanes(tmux, paneRepository);
  return summarizeSessions(panes);
}

async function createSession(
  input: { name: string; cwd: string; workspaceId?: string },
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  workspaceCatalog: WorkspaceSelectionCatalog,
): Promise<TmuxSession> {
  const cwd = await workspaceCatalog.resolveLegacyDirectory(input.cwd);
  if (tmux.hasSession(input.name)) {
    throw new AgentdHttpError(409, "session_exists", `tmux session already exists: ${input.name}`);
  }

  tmux.createSession(input.name, cwd);
  const panes = await syncPanes(tmux, paneRepository);
  const session = summarizeSessions(panes.filter((pane) => pane.sessionName === input.name)).find((candidate) => candidate.name === input.name);
  if (!session || !panes.some((pane) => pane.sessionName === input.name)) {
    throw new AgentdHttpError(503, "session_not_visible", "tmux created the session but agentd could not read it");
  }
  return session;
}

async function listCurrentPanes(
  tmux: TmuxAdapter,
  paneRepository: DrizzlePaneRepository,
  sessionName?: string,
): Promise<PaneRecord[]> {
  const panes = await syncPanes(tmux, paneRepository);
  return sessionName ? panes.filter((pane) => pane.sessionName === sessionName) : panes;
}

async function createPane(
  input: CreatePaneRequest,
  tmux: TmuxAdapter,
  repository: DrizzlePaneRepository,
  viewportManager: TmuxViewportManager,
  workspaceCatalog: WorkspaceSelectionCatalog,
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

  const command = input.kind === "agent" ? agentCommand(input) : undefined;
  const tmuxPaneId = input.placement === "window"
    ? tmux.newWindow(input.sessionName, cwd, command)
    : createSplitPane(input, tmux, cwd, command);
  if (input.placement !== "window" && input.targetPaneId) {
    viewportManager.reassertMobileViewport(input.targetPaneId);
  }
  const panes = await syncPanes(tmux, repository);
  const current = panes.find((pane) => pane.tmuxPaneId === tmuxPaneId);
  if (!current) {
    throw new AgentdHttpError(503, "pane_not_visible", "tmux created the pane but agentd could not read it");
  }

  const record: PaneSummary = {
    ...current,
    kind: input.kind,
    name: input.name,
    projectId: input.projectId ?? current.projectId,
    workspaceId: input.workspaceId ?? current.workspaceId,
    agentId: input.agentId,
    state: input.kind === "agent" ? "starting" : "running",
  };
  await repository.upsert(record);
  tmux.setPaneOption(tmuxPaneId, "@agentd.pane_id", record.id);
  tmux.setPaneOption(tmuxPaneId, "@agentd.pane_name", input.name);
  tmux.setPaneOption(tmuxPaneId, "@agentd.agent_id", input.agentId ?? "");
  tmux.setPaneOption(tmuxPaneId, "@agentd.kind", input.kind);
  tmux.setPaneOption(tmuxPaneId, "@agentd.project_id", input.projectId ?? "");
  tmux.setPaneOption(tmuxPaneId, "@agentd.workspace_id", input.workspaceId ?? "");
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
  tmuxPanes = tmux.listPanes(),
): Promise<PaneRecord[]> {
  const now = new Date().toISOString();
  const records: PaneRecord[] = [];

  for (const tmuxPane of tmuxPanes) {
    const existing = await repository.findByTmuxPaneId(tmuxPane.paneId);
    const kind = resolvePaneKind(tmuxPane, existing);
    const agentId = kind === "agent" ? tmuxPane.agentdAgentId ?? executableName(tmuxPane.command) ?? existing?.agentId ?? "agent" : null;
    const state = kind === "agent" ? inferAgentState(tmux, tmuxPane, existing?.state ?? "running") : "running";
    const record: PaneRecord = {
      id: existing?.id ?? tmuxPane.agentdPaneId ?? `pane-${randomBytes(16).toString("hex")}`,
      tmuxPaneId: tmuxPane.paneId,
      sessionName: tmuxPane.sessionName,
      windowId: tmuxPane.windowId,
      kind,
      name: tmuxPane.agentdName ?? (existing?.name && existing.name !== tmuxPane.paneId ? existing.name : tmuxPane.title || tmuxPane.command || tmuxPane.paneId),
      cwd: tmuxPane.cwd,
      projectId: existing?.projectId ?? null,
      workspaceId: existing?.workspaceId ?? null,
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
    records.push(record);
  }

  return records;
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
      project: basename(cwd) || name,
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

function agentCommand(input: CreatePaneRequest): string {
  const binary = process.env.AGENTD_AGENT_COMMAND ?? "agent";
  const args = [binary, "run", input.agentId!, "--no-worktree", "--name", input.name];
  if (input.useWorktree) {
    args.splice(3, 1, "--worktree");
    if (input.projectName) args.push("--project", input.projectName);
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
