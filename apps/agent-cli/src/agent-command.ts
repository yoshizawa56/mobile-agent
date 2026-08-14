import { createHash, randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { buildAgentShellCommand, configureManagedTmuxSession, TmuxAdapter } from "@mobile-agent/agentd/tmux";
import type {
  AgentBackend,
  AgentSessionRecord,
  WorkspaceRecord,
} from "@mobile-agent/domain";
import { isValidWorktreeCopyPattern, normalizeWorktreeCopyPatterns } from "@mobile-agent/domain";
import {
  defaultAgentDatabaseFile,
  createAgentDatabase,
  DrizzleAgentSessionRepository,
  DrizzleWorkspaceRepository,
  recordAuditEvent,
  type AgentDatabase,
} from "@mobile-agent/persistence";
import { manageCodexThread } from "./codex-remote.js";

export type AgentCommandIO = {
  out: Writable;
  err: Writable;
};

export type AgentCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  io?: AgentCommandIO;
  databaseFile?: string;
  repositoryRoot?: string;
  tmux?: TmuxAdapter;
};

type WorkspaceContext = WorkspaceRecord;

type RunOptions = {
  backend: AgentBackend;
  name?: string;
  useWorktree: boolean;
  worktreeRoot?: string;
  setupHook?: string;
  cleanupHook?: string;
  setupHookExplicit: boolean;
  cleanupHookExplicit: boolean;
  codexProfile: string;
  backendArgs: string[];
};

type ResumeOptions = {
  global: boolean;
  reference: string;
  backendArgs: string[];
};

type ProcessResult = {
  code: number;
  interrupted: boolean;
};

type ShellOptions = {
  shell?: string;
  command: string[];
  exitAfterCommand: boolean;
};

type TmuxNewSessionOptions = {
  name: string;
  cwd: string;
  detached: boolean;
};

const sessionNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const defaultCodexProfile = "local-agent";

/**
 * Clean TypeScript implementation of the dotfiles `agent` wrapper.
 *
 * The command deliberately keeps lifecycle state in SQLite instead of shell
 * state files. It owns the backend process, managed git worktree, workspace
 * hooks, resume metadata, and Codex Remote Control lifecycle as one unit.
 */
export class AgentCommand {
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly io: AgentCommandIO;
  private readonly repositoryRoot: string;
  private readonly hookOutputRoot: string;
  private readonly defaultCodexRemote: string;
  private readonly databaseFile: string;
  private readonly tmux: TmuxAdapter;
  private database: AgentDatabase | undefined;
  private sessions!: DrizzleAgentSessionRepository;
  private workspaces!: DrizzleWorkspaceRepository;

  public constructor(options: AgentCommandOptions = {}) {
    this.cwd = realpathSafe(options.cwd ?? process.cwd());
    this.env = { ...process.env, ...options.env };
    this.io = options.io ?? { out: process.stdout, err: process.stderr };
    this.repositoryRoot = options.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    this.hookOutputRoot = resolveFromRoot(this.env.AGENT_HOOK_OUTPUT_DIR ?? join(homedir(), ".local", "state", "mobile-agent", "hooks"), this.repositoryRoot);
    this.defaultCodexRemote = this.env.AGENT_CODEX_REMOTE === undefined ? "unix://" : this.env.AGENT_CODEX_REMOTE;
    this.databaseFile = options.databaseFile ?? defaultAgentDatabaseFile(this.env);
    this.tmux = options.tmux ?? new TmuxAdapter(this.env.AGENTD_TMUX_SOCKET, undefined, this.env);
  }

  public close(): void {
    this.database?.close();
  }

  public async execute(args: string[]): Promise<number> {
    const [command = ""] = args;
    switch (command) {
      case "run": {
        const backend = args[1];
        if (backend !== "codex" && backend !== "claude") throw new AgentCommandError("run requires codex or claude");
        return this.runSession(backend, this.parseRunOptions(backend, args.slice(2)));
      }
      case "shell":
        if (args.includes("-h") || args.includes("--help")) {
          this.write("Usage: agent shell [--shell PATH] [--exit-after-command] [-- COMMAND...]\n");
          return 0;
        }
        return this.runShell(this.parseShellOptions(args.slice(1)));
      case "tmux":
        return this.runTmux(args.slice(1));
      case "resume":
        if (args[1] === "-h" || args[1] === "--help") {
          this.write("Usage: agent resume [--global] NAME [-- BACKEND_ARGS...]\n");
          return 0;
        }
        this.ensureDatabase();
        return this.resumeSession(this.parseResumeOptions(args.slice(1)));
      case "list":
        if (args.includes("-h") || args.includes("--help")) {
          this.write("Usage: agent list [--global] [--names|--json]\n");
          return 0;
        }
        this.ensureDatabase();
        return this.listSessions(this.parseListOptions(args.slice(1)));
      case "cleanup":
        if (args.includes("-h") || args.includes("--help")) {
          this.write("Usage: agent cleanup [--global] [--force] NAME\n");
          return 0;
        }
        this.ensureDatabase();
        return this.cleanupSession(this.parseCleanupOptions(args.slice(1)));
      case "doctor":
        if (args.includes("-h") || args.includes("--help")) {
          this.write("Usage: agent doctor [--verbose]\n");
          return 0;
        }
        return this.doctor(this.parseDoctorOptions(args.slice(1)));
      case "help":
      case "--help":
      case "-h":
        this.printUsage();
        return 0;
      default:
        this.printUsage();
        return 2;
    }
  }

  private parseRunOptions(backend: AgentBackend, args: string[]): RunOptions {
    let name: string | undefined;
    let useWorktree = false;
    let worktreeRoot: string | undefined;
    let setupHook: string | undefined;
    let cleanupHook: string | undefined;
    let setupHookExplicit = false;
    let cleanupHookExplicit = false;
    let codexProfile = this.env.AGENT_CODEX_PROFILE ?? defaultCodexProfile;
    const backendArgs: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--") {
        backendArgs.push(...args.slice(index + 1));
        break;
      }
      if (argument === "-n" || argument === "--name") {
        name = requireOptionValue(argument, args[++index]);
      } else if (argument.startsWith("--name=")) {
        name = argument.slice("--name=".length);
      } else if (argument === "-w" || argument === "--worktree") {
        useWorktree = true;
        const next = args[index + 1];
        if (next && !next.startsWith("-")) {
          if (name) throw new AgentCommandError("worktree name was specified more than once");
          name = next;
          index += 1;
        }
      } else if (argument.startsWith("--worktree=")) {
        useWorktree = true;
        if (name) throw new AgentCommandError("worktree name was specified more than once");
        name = argument.slice("--worktree=".length);
      } else if (argument === "--no-worktree") {
        useWorktree = false;
      } else if (argument === "--worktree-root") {
        worktreeRoot = requireOptionValue(argument, args[++index]);
      } else if (argument.startsWith("--worktree-root=")) {
        worktreeRoot = argument.slice("--worktree-root=".length);
      } else if (argument === "--setup-hook") {
        setupHook = requireOptionValue(argument, args[++index]);
        setupHookExplicit = true;
      } else if (argument.startsWith("--setup-hook=")) {
        setupHook = argument.slice("--setup-hook=".length);
        setupHookExplicit = true;
      } else if (argument === "--cleanup-hook") {
        cleanupHook = requireOptionValue(argument, args[++index]);
        cleanupHookExplicit = true;
      } else if (argument.startsWith("--cleanup-hook=")) {
        cleanupHook = argument.slice("--cleanup-hook=".length);
        cleanupHookExplicit = true;
      } else if (argument === "--no-setup-hook") {
        setupHook = undefined;
        setupHookExplicit = true;
      } else if (argument === "--no-cleanup-hook") {
        cleanupHook = undefined;
        cleanupHookExplicit = true;
      } else if (argument === "--setup-task" || argument === "--cleanup-task" || argument.startsWith("--setup-task=") || argument.startsWith("--cleanup-task=")) {
        throw new AgentCommandError(`${argument} is no longer supported; use workspace hooks or --setup-hook/--cleanup-hook`);
      } else if (argument === "--codex-profile") {
        codexProfile = requireOptionValue(argument, args[++index]);
      } else if (argument.startsWith("--codex-profile=")) {
        codexProfile = argument.slice("--codex-profile=".length);
      } else if (argument === "-p" && backend !== "codex") {
        backendArgs.push(argument);
      } else if (argument === "-p" || argument === "--profile") {
        const value = requireOptionValue(argument, args[++index]);
        backendArgs.push(argument, value);
        if (backend === "codex") codexProfile = value;
      } else if (argument.startsWith("--profile=")) {
        backendArgs.push(argument);
        if (backend === "codex") codexProfile = argument.slice("--profile=".length);
      } else {
        backendArgs.push(argument);
      }
    }

    return {
      backend,
      name,
      useWorktree,
      worktreeRoot,
      setupHook,
      cleanupHook,
      setupHookExplicit,
      cleanupHookExplicit,
      codexProfile,
      backendArgs,
    };
  }

  private parseShellOptions(args: string[]): ShellOptions {
    let shell: string | undefined;
    let exitAfterCommand = false;
    let command: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--") {
        command = args.slice(index + 1);
        break;
      }
      if (argument === "--shell") shell = requireOptionValue(argument, args[++index]);
      else if (argument.startsWith("--shell=")) shell = argument.slice("--shell=".length);
      else if (argument === "--exit-after-command") exitAfterCommand = true;
      else throw new AgentCommandError(`unknown shell option: ${argument}`);
    }

    if (exitAfterCommand && command.length === 0) throw new AgentCommandError("--exit-after-command requires a command after --");
    return { shell, command, exitAfterCommand };
  }

  private async runShell(options: ShellOptions): Promise<number> {
    const shellRunId = this.env.AGENTD_SHELL_RUN_ID ?? randomUUID();
    const paneName = this.env.AGENTD_PANE_NAME ?? this.env.AGENTD_MANAGED_SESSION_NAME ?? "shell";
    const shellEnvironment: NodeJS.ProcessEnv = {
      ...this.env,
      AGENTD_SHELL_RUN_ID: shellRunId,
      AGENTD_SHELL_PARENT_RUN_ID: this.env.AGENTD_PARENT_RUN_ID ?? "",
      AGENTD_PARENT_RUN_ID: shellRunId,
      AGENTD_WRAPPED_SHELL: "1",
    };
    const shellMetadataEnvironment: NodeJS.ProcessEnv = {
      ...shellEnvironment,
      AGENTD_PARENT_RUN_ID: shellEnvironment.AGENTD_SHELL_PARENT_RUN_ID,
    };
    this.markCurrentPane({ kind: "shell", agentId: null, runId: shellRunId, name: paneName }, shellMetadataEnvironment);

    try {
      if (options.command.length > 0) {
        const result = await spawnAttached(options.command[0]!, options.command.slice(1), this.cwd, shellEnvironment);
        if (options.exitAfterCommand) return result.code;
      }

      const shellBinary = resolveExecutable(options.shell ?? this.env.SHELL ?? "sh", this.env);
      return await spawnAttached(shellBinary, ["-i"], this.cwd, shellEnvironment).then((result) => result.code);
    } finally {
      this.restoreCurrentPaneMetadata(shellMetadataEnvironment);
    }
  }

  private async runTmux(args: string[]): Promise<number> {
    const [subcommand = "", ...rest] = args;
    if (subcommand === "" || subcommand === "-h" || subcommand === "--help") {
      this.write("Usage: agent tmux new-session [-s NAME] [-c PATH] [--detached]\n");
      return subcommand === "" ? 2 : 0;
    }
    if (subcommand !== "new-session") throw new AgentCommandError(`unknown tmux command: ${subcommand}`);
    if (rest.includes("-h") || rest.includes("--help")) {
      this.write("Usage: agent tmux new-session [-s NAME] [-c PATH] [--detached]\n");
      return 0;
    }

    const options = parseTmuxNewSessionOptions(rest, this.cwd);
    if (this.tmux.hasSession(options.name)) throw new AgentCommandError(`tmux session already exists: ${options.name}`);

    const managedSessionId = randomUUID();
    const binary = this.env.AGENTD_AGENT_COMMAND ?? "agent";
    const firstPaneCommand = buildAgentShellCommand(binary, {
      AGENTD_MANAGED_SESSION_ID: managedSessionId,
      AGENTD_MANAGED_SESSION_NAME: options.name,
    });
    let created = false;
    try {
      this.tmux.createSession(options.name, options.cwd, firstPaneCommand);
      created = true;
      configureManagedTmuxSession(this.tmux, options.name, managedSessionId, binary);
    } catch (error) {
      if (created) {
        try {
          this.tmux.killSession(options.name);
        } catch {
          // Preserve the original setup error; cleanup is best effort.
        }
      }
      throw error;
    }

    this.write(`agent: created managed tmux session '${options.name}' (${managedSessionId})\n`);
    if (options.detached) return 0;
    return this.tmux.attachSession(options.name);
  }

  private markCurrentPane(
    input: { kind: "shell" | "agent"; agentId: string | null; runId: string; name: string },
    environment = this.env,
  ): void {
    const paneId = environment.TMUX_PANE;
    if (!paneId) return;
    try {
      this.tmux.setAgentPaneMetadata(paneId, "kind", input.kind);
      this.tmux.setAgentPaneMetadata(paneId, "agent_id", input.agentId ?? "");
      this.tmux.setAgentPaneMetadata(paneId, "run_id", input.runId);
      this.tmux.setAgentPaneMetadata(paneId, "pane_name", input.name);
      this.tmux.setAgentPaneMetadata(paneId, "managed_session_id", environment.AGENTD_MANAGED_SESSION_ID ?? "");
      const parentRunId = input.kind === "shell"
        ? environment.AGENTD_SHELL_PARENT_RUN_ID ?? environment.AGENTD_PARENT_RUN_ID ?? ""
        : environment.AGENTD_PARENT_RUN_ID ?? "";
      this.tmux.setAgentPaneMetadata(paneId, "parent_run_id", parentRunId);
    } catch {
      // A shell can also run outside tmux or against a server that disappears
      // while the wrapper is starting. The wrapper must remain usable there.
    }
  }

  private restoreCurrentPaneMetadata(environment = this.env): void {
    const shellRunId = environment.AGENTD_SHELL_RUN_ID;
    if (!shellRunId) return;
    this.markCurrentPane({
      kind: "shell",
      agentId: null,
      runId: shellRunId,
      name: environment.AGENTD_PANE_NAME ?? environment.AGENTD_MANAGED_SESSION_NAME ?? "shell",
    }, environment);
  }

  private parseResumeOptions(args: string[]): ResumeOptions {
    let global = false;
    let reference: string | undefined;
    const backendArgs: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "-g" || argument === "--global") {
        global = true;
      } else if (argument === "-h" || argument === "--help") {
        this.write("Usage: agent resume [--global] NAME [-- BACKEND_ARGS...]\n");
        return { global, reference: "", backendArgs: [] };
      } else if (argument === "--") {
        backendArgs.push(...args.slice(index + 1));
        break;
      } else if (argument.startsWith("-") && !reference) {
        throw new AgentCommandError(`unknown resume option: ${argument}`);
      } else if (!reference) {
        reference = argument;
      } else {
        backendArgs.push(argument);
      }
    }
    if (!reference) throw new AgentCommandError("resume requires a session name");
    return { global, reference, backendArgs };
  }

  private parseListOptions(args: string[]): { global: boolean; names: boolean; json: boolean } {
    let global = false;
    let names = false;
    let json = false;
    for (const argument of args) {
      if (argument === "-g" || argument === "--global") global = true;
      else if (argument === "--names") names = true;
      else if (argument === "--json") json = true;
      else if (argument === "-h" || argument === "--help") {
        this.write("Usage: agent list [--global] [--names|--json]\n");
        return { global, names: false, json: false };
      } else throw new AgentCommandError(`unknown list option: ${argument}`);
    }
    if (names && json) throw new AgentCommandError("--names and --json cannot be combined");
    return { global, names, json };
  }

  private parseCleanupOptions(args: string[]): { global: boolean; force: boolean; reference: string } {
    let global = false;
    let force = false;
    let reference = "";
    for (const argument of args) {
      if (argument === "-g" || argument === "--global") global = true;
      else if (argument === "--force") force = true;
      else if (argument === "-h" || argument === "--help") {
        this.write("Usage: agent cleanup [--global] [--force] NAME\n");
        return { global, force, reference };
      } else if (argument.startsWith("-")) throw new AgentCommandError(`unknown cleanup option: ${argument}`);
      else if (reference) throw new AgentCommandError("cleanup accepts exactly one session name");
      else reference = argument;
    }
    if (!reference) throw new AgentCommandError("cleanup requires a session name");
    return { global, force, reference };
  }

  private parseDoctorOptions(args: string[]): { verbose: boolean } {
    let verbose = false;
    for (const argument of args) {
      if (argument === "--verbose") verbose = true;
      else if (argument === "-h" || argument === "--help") {
        this.write("Usage: agent doctor [--verbose]\n");
        return { verbose: false };
      } else throw new AgentCommandError(`unknown doctor option: ${argument}`);
    }
    return { verbose };
  }

  private async runSession(backend: AgentBackend, options: RunOptions): Promise<number> {
    const backendBinary = resolveBackendCommand(backend, this.env);
    if (hasOption("--help", options.backendArgs) || hasOption("-h", options.backendArgs)) {
      const helpArgs = backend === "codex" && !hasOption("--profile", options.backendArgs) && !hasOption("-p", options.backendArgs)
        ? ["--profile", options.codexProfile, ...options.backendArgs]
        : options.backendArgs;
      return runAttachedProcess(backendBinary, helpArgs, this.cwd, this.env);
    }

    this.ensureDatabase();
    await ensureCodexRemoteControl(backend, options.backendArgs, backendBinary, this.defaultCodexRemote, this.env);
    const workspace = await this.resolveWorkspace();
    const setupHook = options.setupHookExplicit
      ? (options.setupHook ? this.resolveHookPath(options.setupHook, workspace.rootPath) : null)
      : options.useWorktree ? this.resolveStoredHook(workspace.setupScriptPath) : null;
    const cleanupHook = options.cleanupHookExplicit
      ? (options.cleanupHook ? this.resolveHookPath(options.cleanupHook, workspace.rootPath) : null)
      : options.useWorktree ? this.resolveStoredHook(workspace.cleanupScriptPath) : null;

    const name = options.name ?? await this.generateName(workspace.id, backend);
    validateSessionName(name);
    if (await this.sessions.findByName(workspace.id, name)) throw new AgentCommandError(`session name already exists in this workspace: ${name}`);

    const worktree = options.useWorktree ? this.createWorktree(workspace, name, options.worktreeRoot) : emptyWorktree();
    const now = timestamp();
    const session: AgentSessionRecord = {
      id: randomUUID(),
      name,
      backend,
      status: "starting",
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      workspaceName: workspace.name,
      ...worktree,
      useWorktree: options.useWorktree,
      setupHook,
      cleanupHook,
      setupOutputFile: null,
      cleanupOutputFile: null,
      backendSessionId: backend === "claude" ? optionValue("--session-id", options.backendArgs) ?? randomUUID() : null,
      codexProfile: backend === "codex" ? options.codexProfile : null,
      codexRemote: backend === "codex" ? codexRemoteEndpoint(options.backendArgs, this.defaultCodexRemote) : null,
      setupRan: false,
      resuming: false,
      baselineStatus: null,
      codexSessionBaseline: null,
      lastExitStatus: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.sessions.insert(session);
    this.audit("agent_session.created", session.id, { name, backend, workspace: workspace.rootPath });

    let current = updateSession(session, { status: "setup" });
    await this.sessions.update(current);
    if (!(await this.copyWorktreeFiles(current, workspace.worktreeCopyPatterns))) {
      current = updateSession(current, { status: "setup_failed" });
      await this.sessions.update(current);
      throw new AgentCommandError(`worktree file copy failed; mapping retained as '${name}'`);
    }
    if (!(await this.runHook(current, "setup"))) {
      current = updateSession(current, { status: "setup_failed" });
      await this.sessions.update(current);
      throw new AgentCommandError(`setup hook failed; mapping retained as '${name}'`);
    }
    current = updateSession(current, { setupRan: Boolean(current.setupHook) });
    if (current.useWorktree) current = updateSession(current, { baselineStatus: this.gitStatus(current.worktreePath!) });
    current = updateSession(current, { status: "ready" });
    await this.sessions.update(current);

    const runDir = current.worktreePath ?? current.workspaceRoot;
    const codexBaseline = await this.captureCodexSessionBaseline(current);
    if (!codexBaseline) {
      current = updateSession(current, { status: "setup_failed" });
      await this.sessions.update(current);
      throw new AgentCommandError("Codex rollout baseline capture failed; mapping retained");
    }
    const startedAt = Math.floor(Date.now() / 1000);
    current = updateSession(current, { status: "running" });
    await this.sessions.update(current);
    const command = buildRunCommand(current, options.backendArgs, this.defaultCodexRemote, backendBinary);
    this.markCurrentPane({ kind: "agent", agentId: backend, runId: current.id, name: current.name });
    const result = await this.runBackend(current, command, runDir, startedAt);
    try {
      return await this.finalizeSession(current, result, startedAt, runDir, codexBaseline);
    } finally {
      this.restoreCurrentPaneMetadata();
    }
  }

  private async resumeSession(options: ResumeOptions): Promise<number> {
    if (!options.reference) return 0;
    const session = await this.locateSession(options.reference, options.global);
    if (session.status === "setup_failed") throw new AgentCommandError(`session '${session.name}' has a failed setup; clean it up before retrying`);
    if (!session.backendSessionId) throw new AgentCommandError(`session '${session.name}' has no backend session ID; it cannot be resumed`);
    const runDir = session.worktreePath ?? session.workspaceRoot;
    if (!existsSync(runDir)) throw new AgentCommandError(`session working directory is missing: ${runDir}`);
    if (session.useWorktree && !this.worktreeIsRegistered(session)) throw new AgentCommandError(`managed worktree is no longer registered: ${session.worktreePath}`);
    const backendBinary = resolveBackendCommand(session.backend, this.env);
    await ensureCodexRemoteControl(session.backend, options.backendArgs, backendBinary, session.codexRemote ?? this.defaultCodexRemote, this.env);
    const command = buildResumeCommand(session, options.backendArgs, this.defaultCodexRemote, backendBinary);
    const current = updateSession(session, { status: "resuming", resuming: true });
    await this.sessions.update(current);
    const startedAt = Math.floor(Date.now() / 1000);
    this.markCurrentPane({ kind: "agent", agentId: session.backend, runId: current.id, name: current.name });
    const result = await this.runBackend(current, command, runDir, startedAt);
    try {
      return await this.finalizeSession(current, result, startedAt, runDir, true);
    } finally {
      this.restoreCurrentPaneMetadata();
    }
  }

  private async listSessions(options: { global: boolean; names: boolean; json: boolean }): Promise<number> {
    const workspace = options.global ? undefined : (await this.resolveWorkspace()).id;
    const sessions = await this.sessions.list(workspace);
    if (options.names) {
      for (const session of sessions) this.write(`${options.global ? `${session.workspaceName}/` : ""}${session.name}\n`);
      return 0;
    }
    if (options.json) {
      for (const session of sessions) this.write(`${JSON.stringify(toSessionJson(session))}\n`);
      return 0;
    }
    if (options.global) this.write(padHeader(["WORKSPACE", "NAME", "BACKEND", "STATUS", "BRANCH", "WORKTREE"]));
    else this.write(padHeader(["NAME", "BACKEND", "STATUS", "BRANCH", "WORKTREE"]));
    if (sessions.length === 0) {
      this.info("no managed sessions");
      return 0;
    }
    for (const session of sessions) {
      const values = [session.name, session.backend, session.status, session.branch ?? "-", session.worktreePath ?? "-"];
      this.write(options.global ? padRow([session.workspaceName, ...values]) : padRow(values));
    }
    return 0;
  }

  private async cleanupSession(options: { global: boolean; force: boolean; reference: string }): Promise<number> {
    const session = await this.locateSession(options.reference, options.global);
    if (session.useWorktree && session.worktreePath && existsSync(session.worktreePath)) {
      if (!this.worktreeIsRegistered(session)) throw new AgentCommandError(`managed path is not registered as a git worktree; refusing to delete it: ${session.worktreePath}`);
    }
    const dirty = session.useWorktree && session.worktreePath ? this.worktreeHasAgentChanges(session) : false;
    let force = options.force;
    if (session.useWorktree && !force && !(await this.confirmCleanup(session, dirty))) {
      this.info(`cleanup cancelled; session '${session.name}' was kept`);
      return 0;
    }
    if (dirty) force = true;
    if (!(await this.removeSessionRecord(session, force))) return 1;
    this.info(`session '${session.name}' cleaned up`);
    return 0;
  }

  private async doctor(options: { verbose: boolean }): Promise<number> {
    let status = 0;
    for (const command of ["git", "zsh", "codex", "claude"]) {
      const path = commandPath(command, this.env);
      if (path) this.write(`${command}: ${path}\n`);
      else {
        this.write(`${command}: missing\n`, true);
        status = 1;
      }
    }
    const profilePath = join(this.env.CODEX_HOME ?? join(homedir(), ".codex"), `${this.env.AGENT_CODEX_PROFILE ?? defaultCodexProfile}.config.toml`);
    if (existsSync(profilePath)) {
      this.write(`codex profile: ${profilePath}\n`);
      const codex = commandPath("codex", this.env);
      if (codex && spawnSync(codex, ["--profile", this.env.AGENT_CODEX_PROFILE ?? defaultCodexProfile, "--strict-config", "--help"], { stdio: "ignore", env: this.env }).status !== 0) {
        this.write("codex profile validation: failed\n", true);
        status = 1;
      } else this.write("codex profile validation: ok\n");
    } else {
      this.write(`codex profile: missing (${profilePath})\n`, true);
      status = 1;
    }
    const mise = commandPath("mise", this.env);
    this.write(mise ? `mise: ${mise}\n` : "mise: unavailable (not required for workspace hooks)\n");
    if (options.verbose) {
      this.write(`database: ${this.databaseFile}\n`);
      this.write(`codex remote: ${this.defaultCodexRemote || "native local mode"}\n`);
      this.write(`worktree root pattern: <workspace-parent>/<workspace-name>.worktrees${this.env.AGENT_WORKTREE_ID ? `/${this.env.AGENT_WORKTREE_ID}` : ""}/<session-name>\n`);
    }
    return status;
  }

  private async resolveWorkspace(): Promise<WorkspaceContext> {
    const gitRoot = gitWorkspaceRoot(this.cwd);
    const root = gitRoot ?? this.cwd;
    const id = createHash("sha256").update(root).digest("hex").slice(0, 16);
    const existing = await this.workspaces.findById(id);
    const context: WorkspaceContext = {
      id,
      rootPath: root,
      name: basename(root),
      isGit: Boolean(gitRoot),
      setupScriptPath: existing?.setupScriptPath ?? null,
      cleanupScriptPath: existing?.cleanupScriptPath ?? null,
      worktreeCopyPatterns: existing?.worktreeCopyPatterns ?? [],
      createdAt: timestamp(),
      updatedAt: timestamp(),
    };
    await this.workspaces.upsert(context);
    return context;
  }

  private resolveHookPath(value: string, workspaceRoot: string): string {
    const path = realpathSafe(isAbsolute(value) ? value : join(workspaceRoot, value));
    if (!existsSync(path)) throw new AgentCommandError(`workspace hook does not exist: ${value}`);
    accessSync(path, constants.X_OK);
    if (!statSync(path).isFile()) throw new AgentCommandError(`workspace hook is not a file: ${path}`);
    return path;
  }

  private resolveStoredHook(path: string | null): string | null {
    return path ? this.resolveHookPath(path, this.cwd) : null;
  }

  private async generateName(workspaceId: string, backend: AgentBackend): Promise<string> {
    const prefix = `${backend}-${localTimestamp()}`;
    let candidate = prefix;
    let suffix = 0;
    while (await this.sessions.findByName(workspaceId, candidate)) {
      suffix += 1;
      candidate = `${prefix}-${suffix}`;
    }
    return candidate;
  }

  private createWorktree(workspace: WorkspaceContext, name: string, override?: string): Pick<AgentSessionRecord, "worktreeRoot" | "worktreePath" | "branch" | "baseCommit"> {
    if (!workspace.isGit) throw new AgentCommandError("a managed worktree requires a git workspace; use --no-worktree here");
    const defaultRoot = this.env.AGENT_WORKTREE_ROOT ?? join(dirname(workspace.rootPath), `${workspace.name}.worktrees`);
    const configuredRoot = override ?? (this.env.AGENT_WORKTREE_ID ? join(defaultRoot, this.env.AGENT_WORKTREE_ID) : defaultRoot);
    const worktreeRoot = realpathAfterMkdir(resolveFromRoot(configuredRoot, workspace.rootPath));
    const worktreePath = join(worktreeRoot, name);
    let branch = this.worktreeBranch(name);
    const baseCommit = gitRequired(workspace.rootPath, ["rev-parse", "HEAD"], "cannot determine the workspace HEAD");
    if (gitStatusCode(workspace.rootPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) === 0) {
      branch = `agent/${this.env.AGENT_WORKTREE_ID ?? workspace.id}/${name}`;
    }
    if (gitStatusCode(workspace.rootPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) === 0) throw new AgentCommandError(`agent branch already exists; choose another name or remove it manually: ${branch}`);
    if (existsSync(worktreePath)) throw new AgentCommandError(`worktree path already exists: ${worktreePath}`);
    this.info(`creating worktree '${worktreePath}'`);
    gitRequired(workspace.rootPath, ["worktree", "add", "-b", branch, "--", worktreePath, baseCommit], "git worktree creation failed");
    return { worktreeRoot, worktreePath, branch, baseCommit };
  }

  private worktreeBranch(name: string): string {
    const worktreeId = this.env.AGENT_WORKTREE_ID;
    return worktreeId ? `agent/${worktreeId}/${name}` : `agent/${name}`;
  }

  private async copyWorktreeFiles(session: AgentSessionRecord, configuredPatterns: readonly string[]): Promise<boolean> {
    if (!session.useWorktree || !session.worktreePath || !configuredPatterns.length) return true;

    const patterns = normalizeWorktreeCopyPatterns(configuredPatterns);
    if (patterns.some((pattern) => !isValidWorktreeCopyPattern(pattern))) {
      this.warn("workspace contains an invalid worktree copy pattern");
      return false;
    }

    const sourceFiles = listUnmanagedFiles(session.workspaceRoot);
    const matchedFiles = new Set<string>();
    for (const pattern of patterns) {
      const matches = sourceFiles.filter((file) => matchesWorktreeCopyPattern(pattern, file));
      if (!matches.length) this.warn(`worktree copy pattern matched no unmanaged files: ${pattern}`);
      for (const file of matches) matchedFiles.add(file);
    }

    for (const relativePath of [...matchedFiles].sort()) {
      const sourcePath = resolve(session.workspaceRoot, relativePath);
      const targetPath = resolve(session.worktreePath, relativePath);
      if (!isPathWithin(session.workspaceRoot, sourcePath) || !isPathWithin(session.worktreePath, targetPath)) {
        this.warn(`refusing to copy a path outside the worktree: ${relativePath}`);
        return false;
      }
      try {
        const sourceStat = lstatSync(sourcePath);
        if (!sourceStat.isFile()) {
          this.warn(`refusing to copy a non-regular file: ${relativePath}`);
          return false;
        }
        if (!isPathWithin(session.workspaceRoot, realpathSafe(sourcePath))) {
          this.warn(`refusing to copy a source path outside the workspace: ${relativePath}`);
          return false;
        }
        mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
        if (!isPathWithin(session.worktreePath, realpathSafe(dirname(targetPath)))) {
          this.warn(`refusing to copy through a worktree symlink: ${relativePath}`);
          return false;
        }
        copyFileSync(sourcePath, targetPath);
        chmodSync(targetPath, sourceStat.mode & 0o777);
        this.info(`copied unmanaged file '${relativePath}' into worktree`);
      } catch (error) {
        this.warn(`could not copy unmanaged file '${relativePath}': ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }
    return true;
  }

  private async runHook(session: AgentSessionRecord, kind: "setup" | "cleanup"): Promise<boolean> {
    const hook = kind === "setup" ? session.setupHook : session.cleanupHook;
    if (!hook) return true;
    const runDir = session.worktreePath ?? session.workspaceRoot;
    if (!existsSync(runDir)) {
      this.warn(`cannot run ${kind} hook; directory does not exist: ${runDir}`);
      return false;
    }
    const outputFile = `${this.outputFileFor(session, kind)}.${randomUUID()}`;
    this.info(`running workspace hook '${hook}' (${kind})`);
    const args = [
      "--name", session.name,
      "--backend", session.backend,
      "--workspace", session.workspaceRoot,
      "--worktree", session.worktreePath ?? "",
      "--session-id", session.backendSessionId ?? "",
      "--state-id", session.id,
      "--resuming", session.resuming ? "1" : "0",
    ];
    if (kind === "cleanup" && session.setupOutputFile) args.push("--setup-output-file", session.setupOutputFile);
    const child = spawn(hook, args, {
      cwd: runDir,
      env: {
        ...this.env,
        AGENT_NAME: session.name,
        AGENT_BACKEND: session.backend,
        AGENT_WORKSPACE: session.workspaceRoot,
        AGENT_WORKTREE: session.worktreePath ?? "",
        AGENT_SESSION_ID: session.backendSessionId ?? "",
        AGENT_STATE_ID: session.id,
        AGENT_HOOK_KIND: kind,
        AGENT_HOOK_SCRIPT: hook,
        AGENT_SETUP_OUTPUT_FILE: session.setupOutputFile ?? "",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const output = createWriteStream(outputFile, { mode: 0o600 });
    child.stdout?.on("data", (chunk: Buffer) => {
      this.io.out.write(chunk);
      output.write(chunk);
    });
    const exitCode = await new Promise<number>((resolvePromise) => {
      child.once("error", () => resolvePromise(127));
      child.once("close", (code) => resolvePromise(code ?? 1));
    });
    await new Promise<void>((resolvePromise, reject) => {
      output.once("finish", resolvePromise);
      output.once("error", reject);
      output.end();
    });
    const finalOutput = this.outputFileFor(session, kind);
    renameSync(outputFile, finalOutput);
    const next = updateSession(session, kind === "setup" ? { setupOutputFile: finalOutput } : { cleanupOutputFile: finalOutput });
    Object.assign(session, next);
    await this.sessions.update(next);
    return exitCode === 0;
  }

  private outputFileFor(session: AgentSessionRecord, kind: "setup" | "cleanup"): string {
    const dir = join(this.hookOutputRoot, session.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return join(dir, `${kind}.log`);
  }

  private async runBackend(session: AgentSessionRecord, command: string[], runDir: string, startedAt: number): Promise<ProcessResult> {
    this.setTerminalTitle(session.name);
    const nameWatcher = session.backend === "codex" && session.backendSessionId === null && session.codexRemote ? this.watchCodexSessionName(session, startedAt, runDir) : undefined;
    const result = await spawnAttached(command[0]!, command.slice(1), runDir, {
      ...this.env,
      AGENTD_RUN_ID: session.id,
      AGENTD_AGENT_ID: session.backend,
    });
    if (nameWatcher) await nameWatcher.stop();
    this.restoreTerminalTitle();
    return result;
  }

  private async finalizeSession(session: AgentSessionRecord, result: ProcessResult, startedAt: number, runDir: string, codexBaseline: boolean): Promise<number> {
    if (session.backend === "codex" && !session.backendSessionId && codexBaseline) {
      const id = await this.discoverCodexSessionId(startedAt, runDir, session.id);
      if (id) session = updateSession(session, { backendSessionId: id });
      else this.warn(`Codex session ID could not be found; '${session.name}' cannot be resumed until the mapping is repaired`);
    }
    session = updateSession(session, { lastExitStatus: result.code, updatedAt: timestamp() });
    if (result.interrupted || result.code === 130 || result.code === 143) {
      session = updateSession(session, { status: "interrupted" });
      await this.sessions.update(session);
      this.info(`session '${session.name}' kept for resume after interruption`);
      return result.code;
    }
    session = updateSession(session, { status: "exited" });
    await this.sessions.update(session);
    if (!session.useWorktree) {
      this.info(`session '${session.name}' mapping retained; use 'agent resume ${session.name}' or 'agent cleanup ${session.name}'`);
      return result.code;
    }
    const dirty = this.worktreeHasAgentChanges(session);
    if (!(await this.confirmCleanup(session, dirty))) {
      this.info(`cleanup declined; session '${session.name}' kept for resume`);
      return result.code;
    }
    if (!(await this.removeSessionRecord(session, dirty))) {
      this.info(`session '${session.name}' retained because cleanup did not complete`);
      return result.code === 0 ? 1 : result.code;
    }
    this.info(`session '${session.name}' cleaned up`);
    return result.code;
  }

  private async removeSessionRecord(session: AgentSessionRecord, force: boolean): Promise<boolean> {
    if (session.useWorktree && session.worktreePath && existsSync(session.worktreePath) && !this.worktreeIsRegistered(session)) {
      this.warn(`managed path is not registered as a git worktree; refusing to delete it: ${session.worktreePath}`);
      return false;
    }
    if (session.backend === "codex" && session.codexRemote) {
      if (!(await this.manageRemoteThread(session, "archive"))) return false;
    }
    if (!(await this.runHook(session, "cleanup"))) {
      if (session.backend === "codex" && session.codexRemote) await this.manageRemoteThread(session, "unarchive");
      this.warn("cleanup hook failed; retaining session mapping");
      return false;
    }
    if (session.useWorktree && session.worktreePath && existsSync(session.worktreePath)) {
      try {
        gitRequired(session.workspaceRoot, ["worktree", "remove", ...(force ? ["--force"] : []), "--", session.worktreePath], "git worktree removal failed");
      } catch {
        if (session.backend === "codex" && session.codexRemote) await this.manageRemoteThread(session, "unarchive");
        this.warn("git worktree removal failed; retaining session mapping");
        return false;
      }
      try {
        unlinkEmptyDirectory(session.worktreeRoot);
      } catch {
        // A root containing another managed worktree is expected to remain.
      }
      if (session.branch) {
        const head = gitOutputOrEmpty(session.workspaceRoot, ["rev-parse", "--verify", session.branch]);
        if (head && head === session.baseCommit) gitStatusCode(session.workspaceRoot, ["branch", "-d", session.branch]);
        else if (head) this.info(`keeping committed agent branch '${session.branch}'`);
      }
    }
    await this.sessions.delete(session.id);
    this.audit("agent_session.deleted", session.id, { name: session.name });
    this.removeHookOutputs(session);
    return true;
  }

  private removeHookOutputs(session: AgentSessionRecord): void {
    for (const path of [session.setupOutputFile, session.cleanupOutputFile]) {
      if (!path) continue;
      try {
        unlinkSync(path);
      } catch {
        // Hook output is an artifact, not lifecycle state. A missing file is harmless.
      }
    }
    unlinkEmptyDirectory(join(this.hookOutputRoot, session.id));
  }

  private async confirmCleanup(session: AgentSessionRecord, dirty: boolean): Promise<boolean> {
    if (this.env.AGENT_ASSUME_YES === "1") return true;
    if (!process.stdin.isTTY && !process.stdout.isTTY) return false;
    const prompt = dirty
      ? `Cleanup session '${session.name}' and remove worktree '${session.worktreePath}' including uncommitted changes? [y/N] `
      : `Cleanup session '${session.name}' and remove worktree '${session.worktreePath}'? [y/N] `;
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await readline.question(prompt);
      return /^(y|yes)$/i.test(answer.trim());
    } finally {
      readline.close();
    }
  }

  private worktreeIsRegistered(session: AgentSessionRecord): boolean {
    if (!session.worktreePath) return false;
    return gitOutputOrEmpty(session.workspaceRoot, ["worktree", "list", "--porcelain"]).split("\n").some((line) => line === `worktree ${session.worktreePath}`);
  }

  private worktreeHasAgentChanges(session: AgentSessionRecord): boolean {
    if (!session.worktreePath || !existsSync(session.worktreePath)) return false;
    const current = this.gitStatus(session.worktreePath);
    return current !== (session.baselineStatus ?? "");
  }

  private gitStatus(cwd: string): string {
    return gitOutputRaw(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  }

  private async captureCodexSessionBaseline(session: AgentSessionRecord): Promise<boolean> {
    if (session.backend !== "codex") return true;
    const files = await this.codexSessionFiles();
    const baseline = files.map((file) => codexMeta(file)?.session_id).filter((value): value is string => Boolean(value));
    // Baselines are persisted in the same database record as a newline list so
    // a restart never depends on an auxiliary state file.
    session.codexSessionBaseline = JSON.stringify({ codexSessions: baseline });
    await this.sessions.update(session);
    return true;
  }

  private async discoverCodexSessionId(startedAt: number, runDir: string, sessionId: string): Promise<string | undefined> {
    const session = await this.sessions.findById(sessionId);
    const endpoint = session?.codexRemote ?? "";
    const attempts = endpoint ? 25 : 1;
    const baseline = new Set<string>(readCodexBaseline(session?.codexSessionBaseline));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const files = await this.codexSessionFiles();
      let best: { id: string; mtime: number } | undefined;
      let fallback: { id: string; mtime: number } | undefined;
      for (const file of files) {
        const stat = statSync(file);
        const meta = codexMeta(file);
        if (!meta || stat.mtimeMs / 1000 < startedAt || meta.cwd !== runDir || !["codex-tui", "codex_chatgpt_ios_remote"].includes(meta.originator ?? "") || meta.thread_source === "subagent" || !meta.session_id || baseline.has(meta.session_id)) continue;
        const candidate = { id: meta.session_id, mtime: stat.mtimeMs };
        if (meta.session_id === meta.id) {
          if (!best || candidate.mtime > best.mtime) best = candidate;
        } else if (!fallback || candidate.mtime > fallback.mtime) fallback = candidate;
      }
      if (best?.id ?? fallback?.id) return best?.id ?? fallback?.id;
      if (attempt + 1 < attempts) await sleep(200);
    }
    return undefined;
  }

  private async codexSessionFiles(): Promise<string[]> {
    const root = join(this.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
    return existsSync(root) ? walkFiles(root).filter((file) => file.endsWith(".jsonl")) : [];
  }

  private watchCodexSessionName(session: AgentSessionRecord, startedAt: number, runDir: string): { stop: () => Promise<void> } {
    let stopped = false;
    const run = async () => {
      while (!stopped) {
        const id = await this.discoverCodexSessionId(startedAt, runDir, session.id);
        if (id) {
          try {
            await this.manageRemoteThread({ ...session, backendSessionId: id }, "name");
            return;
          } catch {
            // The app-server may expose the rollout shortly after the JSONL file.
          }
        }
        await sleep(200);
      }
    };
    const promise = run();
    return {
      stop: async () => {
        stopped = true;
        await Promise.race([promise, sleep(2_000)]);
      },
    };
  }

  private async manageRemoteThread(session: AgentSessionRecord, operation: "name" | "archive" | "unarchive"): Promise<boolean> {
    if (!session.codexRemote) return true;
    if (session.codexRemote !== "unix://") {
      this.warn(`cannot ${operation} Codex remote thread on unsupported endpoint: ${session.codexRemote}`);
      return false;
    }
    if (!session.backendSessionId) {
      this.warn(`cannot ${operation} Codex remote thread; session ID is missing`);
      return false;
    }
    try {
      const helper = this.env.AGENT_CODEX_NAME_BIN;
      if (helper) {
        const executable = resolveExecutable(helper, this.env);
        const args = ["--thread-id", session.backendSessionId, operation === "name" ? "--name" : `--${operation}`];
        if (operation === "name") args.push(session.name);
        const result = spawnSync(executable, args, { stdio: "ignore", env: this.env });
        if (result.status !== 0) throw new Error(`helper exited with ${result.status}`);
      } else {
        await manageCodexThread({ threadId: session.backendSessionId, operation, name: operation === "name" ? session.name : undefined });
      }
      return true;
    } catch (error) {
      this.warn(`could not ${operation} Codex remote thread '${session.backendSessionId}': ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async locateSession(reference: string, global: boolean): Promise<AgentSessionRecord> {
    validateSessionName(reference.includes("/") ? reference.slice(reference.indexOf("/") + 1) : reference);
    const sessions = await this.sessions.list(global ? undefined : (await this.resolveWorkspace()).id);
    if (!global) {
      const session = sessions.find((candidate) => candidate.name === reference);
      if (!session) throw new AgentCommandError(`session not found in this workspace: ${reference}`);
      return session;
    }
    const [selector, name] = reference.includes("/") ? reference.split("/", 2) : [undefined, reference];
    const matches = sessions.filter((session) => session.name === name && (!selector || session.workspaceId === selector || session.workspaceName === selector));
    if (matches.length === 0) throw new AgentCommandError(`global session not found: ${reference}`);
    if (matches.length > 1) throw new AgentCommandError(`global session name is ambiguous; use WORKSPACE/${name}`);
    return matches[0]!;
  }

  private setTerminalTitle(name: string): void {
    if (this.env.AGENT_SET_TERMINAL_TITLE === "0" || !process.stdout.isTTY) return;
    this.io.out.write(`\u001b]0;agent:${name}\u0007`);
  }

  private restoreTerminalTitle(): void {
    if (this.env.AGENT_SET_TERMINAL_TITLE === "0" || !process.stdout.isTTY) return;
    this.io.out.write("\u001b]0;\u0007");
  }

  private audit(eventType: string, entityId: string, payload: unknown): void {
    recordAuditEvent(this.database!.db, { eventType, entityId, payload });
  }

  private ensureDatabase(): void {
    if (this.database) return;
    this.database = createAgentDatabase(this.databaseFile, {
      migrationsFolder: this.env.AGENTD_MIGRATIONS_DIR ?? this.env.AGENT_MIGRATIONS_DIR,
    });
    this.sessions = new DrizzleAgentSessionRepository(this.database.db);
    this.workspaces = new DrizzleWorkspaceRepository(this.database.db);
  }

  private printUsage(): void {
    this.write(`Usage:
  agent tmux new-session [-s NAME] [-c PATH] [--detached]
  agent shell [--shell PATH] [--exit-after-command] [-- COMMAND...]
  agent run <codex|claude> [OPTIONS] [-- BACKEND_ARGS...]
  agent resume [--global] NAME [-- BACKEND_ARGS...]
  agent list [--global] [--names|--json]
  agent cleanup [--global] [--force] NAME
  agent doctor [--verbose]
  agent daemon <start|status|stop|restart|ensure> [--host HOST] [--port PORT] [--pid-file PATH]
  agent serve tailscale [--port PORT] [--agentd-port PORT]
  agent dev [serve tailscale]

Run options:
  -n, --name NAME          Logical session name; does not create a worktree.
  -w, --worktree [NAME]    Create a managed worktree and agent/<name> branch (dev uses agent/<worktree-id>/<name>).
      --no-worktree        Explicitly run in the current workspace.
      --worktree-root PATH Override the managed worktree parent directory.
      --setup-hook PATH     Override the workspace setup hook.
      --cleanup-hook PATH   Override the workspace cleanup hook.
      --no-setup-hook       Disable the workspace setup hook.
      --no-cleanup-hook     Disable the workspace cleanup hook.
      --codex-profile NAME  Codex profile (default: ${defaultCodexProfile}).
`);
  }

  private write(value: string, error = false): void {
    (error ? this.io.err : this.io.out).write(value);
  }

  private info(value: string): void {
    this.write(`agent: ${value}\n`);
  }

  private warn(value: string): void {
    this.write(`agent: warning: ${value}\n`, true);
  }
}

export class AgentCommandError extends Error {}

export function buildRunCommand(session: AgentSessionRecord, backendArgs: string[], defaultRemote: string, backendBinary: string): string[] {
  if (session.backend === "codex") {
    const args = [backendBinary];
    if (!hasOption("--profile", backendArgs) && !hasOption("-p", backendArgs)) args.push("--profile", session.codexProfile ?? defaultCodexProfile);
    const remote = codexRemoteEndpoint(backendArgs, defaultRemote);
    if (remote && !hasOption("--remote", backendArgs)) args.push("--remote", remote);
    const runDir = session.worktreePath ?? session.workspaceRoot;
    if (remote && !hasOption("--cd", backendArgs) && !hasOption("-C", backendArgs)) args.push("--cd", runDir);
    args.push(...backendArgs);
    return args;
  }
  const args = [backendBinary];
  if (!hasOption("--name", backendArgs) && !hasOption("-n", backendArgs)) args.push("--name", session.name);
  if (!hasOption("--session-id", backendArgs)) args.push("--session-id", session.backendSessionId ?? "");
  if (!hasOption("--permission-mode", backendArgs) && !hasOption("--dangerously-skip-permissions", backendArgs)) args.push("--permission-mode", "auto");
  args.push(...backendArgs);
  return args;
}

export function buildResumeCommand(session: AgentSessionRecord, backendArgs: string[], defaultRemote: string, backendBinary: string): string[] {
  if (!session.backendSessionId) throw new AgentCommandError("backend session ID is required to resume");
  if (session.backend === "codex") {
    const full = buildRunCommand({ ...session, backendSessionId: null }, backendArgs, session.codexRemote ?? defaultRemote, backendBinary);
    const backendStart = full.length - backendArgs.length;
    return [...full.slice(0, backendStart), "resume", session.backendSessionId, ...backendArgs];
  }
  return [backendBinary, "--resume", session.backendSessionId, ...backendArgs];
}

function updateSession(session: AgentSessionRecord, changes: Partial<AgentSessionRecord>): AgentSessionRecord {
  return { ...session, ...changes, updatedAt: changes.updatedAt ?? timestamp() };
}

function emptyWorktree(): Pick<AgentSessionRecord, "worktreeRoot" | "worktreePath" | "branch" | "baseCommit"> {
  return { worktreeRoot: null, worktreePath: null, branch: null, baseCommit: null };
}

function toSessionJson(session: AgentSessionRecord): Record<string, unknown> {
  return {
    id: session.id,
    name: session.name,
    backend: session.backend,
    status: session.status,
    workspace: session.workspaceRoot,
    workspace_id: session.workspaceId,
    workspace_name: session.workspaceName,
    worktree: session.worktreePath,
    branch: session.branch,
    session_id: session.backendSessionId,
    updated_at: session.updatedAt,
  };
}

function resolveFromRoot(value: string, root: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function realpathAfterMkdir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return realpathSafe(path);
}

function timestamp(): string {
  return new Date().toISOString();
}

function localTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function requireOptionValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new AgentCommandError(`${option} requires a value`);
  return value;
}

function parseTmuxNewSessionOptions(args: string[], defaultCwd: string): TmuxNewSessionOptions {
  let name = "agentd";
  let cwd = defaultCwd;
  let detached = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "-s" || argument === "--name") name = requireOptionValue(argument, args[++index]);
    else if (argument.startsWith("--name=")) name = argument.slice("--name=".length);
    else if (argument === "-c" || argument === "--cwd") cwd = resolveFromRoot(requireOptionValue(argument, args[++index]), defaultCwd);
    else if (argument.startsWith("--cwd=")) cwd = resolveFromRoot(argument.slice("--cwd=".length), defaultCwd);
    else if (argument === "-d" || argument === "--detached") detached = true;
    else throw new AgentCommandError(`unknown tmux new-session option: ${argument}`);
  }

  validateSessionName(name);
  if (!existsSync(cwd)) throw new AgentCommandError(`tmux session cwd does not exist: ${cwd}`);
  return { name, cwd: realpathSafe(cwd), detached };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function validateSessionName(name: string): void {
  if (!sessionNamePattern.test(name)) throw new AgentCommandError(`invalid session name '${name}'; use 1-64 letters, digits, '.', '_' or '-'`);
}

function gitWorkspaceRoot(cwd: string): string | undefined {
  try {
    return realpathSafe(execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return undefined;
  }
}

function gitRequired(cwd: string, args: string[], message: string): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new AgentCommandError(message);
  }
}

function gitOutputRaw(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function listUnmanagedFiles(cwd: string): string[] {
  const files = new Set<string>();
  for (const args of [
    ["ls-files", "--others", "--exclude-standard", "-z"],
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
  ]) {
    for (const file of gitOutputRaw(cwd, args).split("\u0000")) {
      if (file) files.add(file);
    }
  }
  return [...files];
}

function matchesWorktreeCopyPattern(pattern: string, path: string): boolean {
  const patternSegments = pattern.split("/");
  const pathSegments = path.split("/");
  const memo = new Map<string, boolean>();

  const match = (patternIndex: number, pathIndex: number): boolean => {
    const key = `${patternIndex}:${pathIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (patternIndex === patternSegments.length) {
      result = pathIndex === pathSegments.length;
    } else if (patternSegments[patternIndex] === "**") {
      result = match(patternIndex + 1, pathIndex)
        || (pathIndex < pathSegments.length && match(patternIndex, pathIndex + 1));
    } else {
      result = pathIndex < pathSegments.length
        && matchSegmentPattern(patternSegments[patternIndex]!, pathSegments[pathIndex]!)
        && match(patternIndex + 1, pathIndex + 1);
    }
    memo.set(key, result);
    return result;
  };

  return match(0, 0);
}

function matchSegmentPattern(pattern: string, value: string): boolean {
  let expression = "^";
  for (const character of pattern) {
    if (character === "*") expression += ".*";
    else expression += /[.\\+^$()|[\]{}]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${expression}$`).test(value);
}

function isPathWithin(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}

function gitOutputOrEmpty(cwd: string, args: string[]): string {
  return gitOutputRaw(cwd, args).trim();
}

function gitStatusCode(cwd: string, args: string[]): number {
  return spawnSync("git", ["-C", cwd, ...args], { stdio: "ignore" }).status ?? 1;
}

function commandPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    return execFileSync("which", [command], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveBackendCommand(backend: AgentBackend, env: NodeJS.ProcessEnv): string {
  const override = env[backend === "codex" ? "AGENT_CODEX_BIN" : "AGENT_CLAUDE_BIN"];
  return resolveExecutable(override ?? backend, env);
}

function resolveExecutable(value: string, env: NodeJS.ProcessEnv): string {
  if (value.includes("/")) {
    accessSync(value, constants.X_OK);
    return value;
  }
  const path = commandPath(value, env);
  if (!path) throw new AgentCommandError(`backend executable not found: ${value}`);
  return path;
}

async function ensureCodexRemoteControl(backend: AgentBackend, args: string[], binary: string, defaultRemote: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (backend !== "codex" || !codexRemoteEndpoint(args, defaultRemote)) return;
  for (const command of [["app-server", "daemon", "enable-remote-control"], ["app-server", "daemon", "start"]]) {
    const result = spawnSync(binary, command, { stdio: "ignore", env });
    if (result.status !== 0) throw new AgentCommandError(`could not run Codex app-server command: ${command.join(" ")}`);
  }
}

async function spawnAttached(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  const child = spawn(binary, args, { cwd, env, stdio: "inherit" });
  let interrupted = false;
  const onInterrupt = (signal: NodeJS.Signals) => {
    interrupted = true;
    child.kill(signal);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  const result = await new Promise<ProcessResult>((resolvePromise) => {
    child.once("error", () => resolvePromise({ code: 127, interrupted }));
    child.once("close", (code, signal) => resolvePromise({ code: code ?? signalExitCode(signal), interrupted }));
  });
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onInterrupt);
  return result;
}

async function runAttachedProcess(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return (await spawnAttached(binary, args, cwd, env)).code;
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

function codexRemoteEndpoint(args: string[], fallback: string): string {
  return optionValue("--remote", args) ?? fallback;
}

function hasOption(name: string, args: string[]): boolean {
  return args.some((argument) => argument === name || argument.startsWith(`${name}=`));
}

function optionValue(name: string, args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    if (argument === name) return args[index + 1];
  }
  return undefined;
}

function readCodexBaseline(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { codexSessions?: unknown };
    return Array.isArray(parsed.codexSessions) ? parsed.codexSessions.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function codexMeta(file: string): { session_id?: string; id?: string; cwd?: string; originator?: string; thread_source?: string } | undefined {
  try {
    const line = readFileSync(file, "utf8").split("\n", 1)[0];
    const parsed = JSON.parse(line) as { type?: string } & Record<string, unknown>;
    if (parsed.type !== "session_meta") return undefined;
    return {
      session_id: stringValue(parsed.session_id),
      id: stringValue(parsed.id),
      cwd: stringValue(parsed.cwd),
      originator: stringValue(parsed.originator),
      thread_source: stringValue(parsed.thread_source),
    };
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function unlinkEmptyDirectory(path: string | null): void {
  if (!path) return;
  try {
    const entries = readdirSync(path);
    if (entries.length === 0) {
      // rmdir is intentionally limited to the exact managed worktree root.
      execFileSync("rmdir", [path], { stdio: "ignore" });
    }
  } catch {
    // The root may be shared or already gone.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function padHeader(values: string[]): string {
  return `${values.map((value) => value.padEnd(24)).join(" ").trimEnd()}\n`;
}

function padRow(values: string[]): string {
  return `${values.map((value) => value.padEnd(24)).join(" ").trimEnd()}\n`;
}
