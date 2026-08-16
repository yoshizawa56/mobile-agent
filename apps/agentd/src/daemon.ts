import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defaultOpenCodeRegistryFile, OpenCodeServerManager } from "@mobile-agent/agents";
import { createLogger, defaultLogFile, errorFields, errorMessage, parseLogLevel, type LogLevel, type Logger } from "@mobile-agent/logging";
import { resolveAgentdPaths, validateAgentdControlSocketPath } from "@mobile-agent/persistence";
import { createAgentdServer } from "./server.js";

export type AgentdCliOptions = {
  host: string;
  port: number;
  pidFile: string;
  controlSocket?: string;
  agentdBaseUrl?: string;
  logLevel?: LogLevel;
  logFile?: string;
  refreshServers?: boolean;
};

type AgentdCommand = "start" | "status" | "stop" | "restart" | "ensure";

type AgentdPidRecord = {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
};

/**
 * A restart marker next to the pid file tells a stopping daemon to leave the
 * owned OpenCode servers running and, when a refresh was requested, the
 * replacing daemon to restart them on their existing ports so configuration or
 * environment changes are picked up while the server URLs stay stable. The
 * marker is consumed by the replacing daemon at boot; stale markers left by a
 * crashed restart are cleared there.
 */
export function restartMarkerPath(pidFile: string): string {
  return `${pidFile}.restart`;
}

export function writeRestartMarker(pidFile: string, refreshServers: boolean): void {
  const path = restartMarkerPath(pidFile);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ pid: process.pid, refreshServers, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
}

/** Report whether a restart was requested, without removing the marker. */
export function hasRestartMarker(pidFile: string): boolean {
  return existsSync(restartMarkerPath(pidFile));
}

/** Remove the marker if present; returns the refresh flag, or undefined when absent. */
export function consumeRestartMarker(pidFile: string): boolean | undefined {
  const path = restartMarkerPath(pidFile);
  if (!existsSync(path)) return undefined;
  let refreshServers = true;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { refreshServers?: unknown };
    refreshServers = parsed.refreshServers !== false;
  } catch {
    // An unreadable marker defaults to a plain restart (keep servers).
  }
  try {
    unlinkSync(path);
  } catch {
    // The marker may already have been removed; its presence already signaled a restart.
  }
  return refreshServers;
}

function removeRestartMarker(pidFile: string): void {
  const path = restartMarkerPath(pidFile);
  try {
    unlinkSync(path);
  } catch {
    // No marker to remove.
  }
}

type ParsedAgentdOptions = {
  options: AgentdCliOptions;
  foreground: boolean;
};

const healthTimeoutMs = 500;
const lifecycleTimeoutMs = 5_000;

export async function runAgentdCommand(args: string[] = []): Promise<ReturnType<typeof createAgentdServer> | undefined> {
  const { command, rest } = normalizeCommand(args);
  if (rest.includes("-h") || rest.includes("--help")) {
    printUsage(command);
    return undefined;
  }

  const parsed = parseAgentdOptions(rest);
  const options = parsed.options;
  switch (command) {
    case "start":
      if (parsed.foreground) return startAgentd(options);
      process.exitCode = await ensureAgentd(options);
      return undefined;
    case "status":
      process.exitCode = await statusAgentd(options);
      return undefined;
    case "stop":
      process.exitCode = await stopAgentd(options);
      return undefined;
    case "restart":
      process.exitCode = await restartAgentd(options);
      return undefined;
    case "ensure":
      process.exitCode = await ensureAgentd(options);
      return undefined;
  }
}

export async function startAgentd(args: string[] | AgentdCliOptions = []): Promise<ReturnType<typeof createAgentdServer> | undefined> {
  const options = Array.isArray(args) ? parseAgentdOptions(normalizeStartCommand(args)).options : args;
  const logger = createLogger({
    service: "agentd",
    mode: options.logFile ? "background" : "attached",
    level: options.logLevel ?? "info",
    logFile: options.logFile,
    output: process.stderr,
    showStack: options.logLevel === "debug",
  });
  const app = createAgentdServer({ ...options, logger });

  try {
    await app.start();
    writePidRecord(options.pidFile, {
      pid: process.pid,
      host: options.host,
      port: options.port,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("process.unhandled_error", {
      message: `unexpected error: ${errorMessage(error)}`,
      ...errorFields(error),
    });
    app.stop();
    logger.close();
    throw error;
  }

  // A restart keeps the owned OpenCode servers running. When the marker asked
  // for a refresh, replace them on their existing ports so configuration or
  // environment changes are picked up; otherwise keep them so running sessions
  // are not interrupted. The marker is consumed here, and stale markers from a
  // crashed restart are cleared too. Best effort: a failed refresh must not
  // block the daemon.
  if (consumeRestartMarker(options.pidFile) === true) {
    void refreshOwnedOpenCodeServers({
      logger,
      registryFile: defaultOpenCodeRegistryFile(process.env),
    });
  }

  let stopped = false;
  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    removePidRecord(options.pidFile, process.pid);
    // A restart keeps the owned OpenCode servers running so running sessions
    // are not interrupted (and the replacing daemon can refresh them on the
    // same ports when asked); only an explicit stop releases them so they are
    // not orphaned when the daemon exits. Best effort: a failed cleanup must
    // not block or fail the shutdown.
    if (hasRestartMarker(options.pidFile)) {
      app.stop();
      logger.close();
      return;
    }
    void disposeOwnedOpenCodeServers({
      logger,
      registryFile: defaultOpenCodeRegistryFile(process.env),
    }).finally(() => {
      app.stop();
      logger.close();
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return app;
}

/**
 * Stop every OpenCode server recorded in the Mobile Agent owned-server
 * registry. Entries pointing at processes this user cannot signal (EPERM) are
 * never force-stopped; the registry is cleared so stale ownership is not kept.
 */
export async function disposeOwnedOpenCodeServers(options: { registryFile: string; logger?: Logger }): Promise<void> {
  const manager = new OpenCodeServerManager({
    registryFile: options.registryFile,
    onLog: (level, message, extra) => {
      if (level === "warn" || level === "error") {
        options.logger?.warn("opencode.server_cleanup", { message, ...extra });
      } else {
        options.logger?.debug("opencode.server_cleanup", { message, ...extra });
      }
    },
  });
  try {
    await manager.disposeAll();
  } catch (error) {
    options.logger?.warn("opencode.server_cleanup_failed", {
      ...errorFields(error),
    });
  }
}

/**
 * Restart every owned OpenCode server on the port it already uses, so a
 * `agent daemon restart` picks up configuration and environment changes while
 * keeping the server URLs stable. Best effort; failures are logged and the
 * affected root is released from the registry.
 */
export async function refreshOwnedOpenCodeServers(options: { registryFile: string; logger?: Logger }): Promise<void> {
  const manager = new OpenCodeServerManager({
    registryFile: options.registryFile,
    onLog: (level, message, extra) => {
      if (level === "warn" || level === "error") {
        options.logger?.warn("opencode.server_refresh", { message, ...extra });
      } else {
        options.logger?.debug("opencode.server_refresh", { message, ...extra });
      }
    },
  });
  try {
    await manager.refreshAll();
  } catch (error) {
    options.logger?.warn("opencode.server_refresh_failed", {
      ...errorFields(error),
    });
  }
}

function normalizeCommand(args: string[]): { command: AgentdCommand; rest: string[] } {
  const [command, ...rest] = args;
  if (!command || command.startsWith("-")) return { command: "start", rest: args };
  if (isAgentdCommand(command)) return { command, rest };
  throw new Error(`unknown agent daemon command: ${command}`);
}

function normalizeStartCommand(args: string[]): string[] {
  const [command, ...rest] = args;
  if (!command || command.startsWith("-")) return args;
  if (command === "start") return rest;
  throw new Error(`unknown agent daemon command: ${command}`);
}

function isAgentdCommand(value: string): value is AgentdCommand {
  return value === "start" || value === "status" || value === "stop" || value === "restart" || value === "ensure";
}

function parseAgentdOptions(args: string[]): ParsedAgentdOptions {
  let host = process.env.AGENTD_HOST ?? "127.0.0.1";
  let port = Number(process.env.AGENTD_PORT ?? 4317);
  const paths = resolveAgentdPaths(process.env);
  let pidFile = paths.pidFile;
  let controlSocket = paths.controlSocket;
  let agentdBaseUrl = process.env.AGENTD_PAIRING_BASE_URL;
  let logLevel = parseLogLevel(process.env.AGENT_LOG_LEVEL, "info");
  let logFile = process.env.AGENT_LOG_FILE;
  let foreground = false;
  let refreshServers = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--foreground") foreground = true;
    else if (argument === "--refresh-servers") refreshServers = true;
    else if (argument === "--host") host = requireValue(argument, args[++index]);
    else if (argument.startsWith("--host=")) host = argument.slice("--host=".length);
    else if (argument === "--port") port = parsePort(argument, requireValue(argument, args[++index]));
    else if (argument.startsWith("--port=")) port = parsePort("--port", argument.slice("--port=".length));
    else if (argument === "--pid-file") pidFile = resolve(requireValue(argument, args[++index]));
    else if (argument.startsWith("--pid-file=")) pidFile = resolve(argument.slice("--pid-file=".length));
    else if (argument === "--control-socket") controlSocket = requireValue(argument, args[++index]);
    else if (argument.startsWith("--control-socket=")) controlSocket = argument.slice("--control-socket=".length);
    else if (argument === "--agentd-base-url") agentdBaseUrl = requireValue(argument, args[++index]);
    else if (argument.startsWith("--agentd-base-url=")) agentdBaseUrl = argument.slice("--agentd-base-url=".length);
    else if (argument === "--log-level") logLevel = parseRequiredLogLevel(argument, requireValue(argument, args[++index]));
    else if (argument.startsWith("--log-level=")) logLevel = parseRequiredLogLevel("--log-level", argument.slice("--log-level=".length));
    else if (argument === "--log-file") logFile = resolve(requireValue(argument, args[++index]));
    else if (argument.startsWith("--log-file=")) logFile = resolve(argument.slice("--log-file=".length));
    else throw new Error(`unknown agent daemon option: ${argument}`);
  }

  validateAgentdControlSocketPath(controlSocket);
  const options: AgentdCliOptions = { host, port, pidFile, controlSocket, agentdBaseUrl, logLevel, logFile };
  if (refreshServers) options.refreshServers = true;
  return { options, foreground };
}

async function statusAgentd(options: AgentdCliOptions): Promise<number> {
  if (await isHealthy(options)) {
    const record = readPidRecord(options.pidFile);
    process.stdout.write(`agentd running${record ? ` (pid ${record.pid})` : ""} at http://${displayHost(options.host)}:${options.port}\n`);
    return 0;
  }

  const record = readPidRecord(options.pidFile);
  if (record && isProcessAlive(record.pid)) {
    process.stderr.write(`agentd process ${record.pid} exists but is not healthy at http://${displayHost(options.host)}:${options.port}\n`);
    return 1;
  }

  if (record) removePidRecord(options.pidFile, record.pid);
  process.stdout.write(`agentd stopped at http://${displayHost(options.host)}:${options.port}\n`);
  return 1;
}

async function stopAgentd(options: AgentdCliOptions, quiet = false): Promise<number> {
  const record = readPidRecord(options.pidFile);
  if (!record) {
    if (await isHealthy(options)) {
      throw new Error(`agentd is healthy but its pid file is missing: ${options.pidFile}; stop it through its service manager`);
    }
    if (!quiet) process.stdout.write("agentd is already stopped\n");
    return 0;
  }

  if (!isProcessAlive(record.pid)) {
    removePidRecord(options.pidFile, record.pid);
    if (!quiet) process.stdout.write("agentd was already stopped; removed stale pid file\n");
    return 0;
  }

  const recordOptions = { ...options, host: record.host, port: record.port };
  if (!(await isHealthy(recordOptions))) {
    throw new Error(`refusing to signal pid ${record.pid}; pid file does not point to a healthy agentd`);
  }

  process.kill(record.pid, "SIGTERM");
  const stopped = await waitFor(() => !isProcessAlive(record.pid), lifecycleTimeoutMs);
  if (!stopped) throw new Error(`agentd pid ${record.pid} did not stop within ${lifecycleTimeoutMs}ms`);
  removePidRecord(options.pidFile, record.pid);
  if (!quiet) process.stdout.write("agentd stopped\n");
  return 0;
}

async function restartAgentd(options: AgentdCliOptions): Promise<number> {
  // Tell the running daemon to keep its OpenCode servers alive so sessions keep
  // their ports across the restart. With --refresh-servers the replacing daemon
  // restarts them on the same ports so configuration changes are picked up.
  // Consumed by the replacing daemon at boot; cleared by a failed restart so a
  // later stop still cleans up.
  writeRestartMarker(options.pidFile, options.refreshServers === true);
  try {
    await stopAgentd(options, true);
  } catch (error) {
    removeRestartMarker(options.pidFile);
    throw error;
  }

  // launchd/systemd may restart a KeepAlive service as soon as its old process
  // exits. Reuse that process when it becomes healthy before spawning a second
  // one ourselves.
  if (await waitFor(() => isHealthy(options), 1_000)) {
    process.stdout.write(`agentd restarted by its service manager at http://${displayHost(options.host)}:${options.port}\n`);
    return 0;
  }

  const child = spawnCurrentDaemon(options);
  if (!(await waitFor(() => isHealthy(options), lifecycleTimeoutMs))) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The child may have exited already; preserve the useful health error.
    }
    throw new Error(`agentd did not become healthy at http://${displayHost(options.host)}:${options.port}`);
  }
  process.stdout.write(`agentd restarted at http://${displayHost(options.host)}:${options.port}\n`);
  return 0;
}

async function ensureAgentd(options: AgentdCliOptions): Promise<number> {
  if (await isHealthy(options)) {
    process.stdout.write(`agentd already running at http://${displayHost(options.host)}:${options.port}\n`);
    return 0;
  }

  const record = readPidRecord(options.pidFile);
  if (record && isProcessAlive(record.pid)) {
    throw new Error(`agentd pid ${record.pid} exists but is not healthy; use 'agent daemon restart'`);
  }

  const child = spawnCurrentDaemon(options);
  if (!(await waitFor(() => isHealthy(options), lifecycleTimeoutMs))) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The child may have exited already; preserve the useful health error.
    }
    throw new Error(`agentd did not become healthy at http://${displayHost(options.host)}:${options.port}`);
  }
  process.stdout.write(`agentd started at http://${displayHost(options.host)}:${options.port}\n`);
  return 0;
}

export function buildDaemonSpawnArgs(options: AgentdCliOptions, entry = process.argv[1]): string[] {
  const sourceEntry = entry && /\.(?:[cm]?js|ts)$/.test(entry) && existsSync(entry);
  const args = sourceEntry ? [entry, "daemon", "start", "--foreground"] : ["daemon", "start", "--foreground"];
  args.push("--host", options.host, "--port", String(options.port), "--pid-file", options.pidFile);
  if (options.controlSocket) args.push("--control-socket", options.controlSocket);
  if (options.agentdBaseUrl) args.push("--agentd-base-url", options.agentdBaseUrl);
  args.push("--log-level", options.logLevel ?? "info", "--log-file", options.logFile ?? defaultLogFile());
  return args;
}

function spawnCurrentDaemon(options: AgentdCliOptions) {
  const args = buildDaemonSpawnArgs(options);
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

async function isHealthy(options: Pick<AgentdCliOptions, "host" | "port">): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthTimeoutMs);
  try {
    const response = await fetch(`http://${displayHost(options.host)}:${options.port}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; service?: string };
    return body.ok === true && body.service === "agentd";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  return await condition();
}

function readPidRecord(path: string): AgentdPidRecord | undefined {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as Partial<AgentdPidRecord>;
    if (!Number.isInteger(record.pid) || !record.host || !Number.isInteger(record.port)) return undefined;
    return record as AgentdPidRecord;
  } catch {
    return undefined;
  }
}

function writePidRecord(path: string, record: AgentdPidRecord): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

function removePidRecord(path: string, expectedPid: number): void {
  const record = readPidRecord(path);
  if (record?.pid !== expectedPid) return;
  try {
    unlinkSync(path);
  } catch {
    // Another lifecycle command may have removed the stale record already.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function parseRequiredLogLevel(option: string, value: string): LogLevel {
  if (value !== "error" && value !== "warn" && value !== "info" && value !== "debug") {
    throw new Error(`${option} must be one of error, warn, info, or debug`);
  }
  return value;
}

function parsePort(option: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${option} must be between 1 and 65535`);
  return port;
}

function displayHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function printUsage(command: AgentdCommand): void {
  const usage = command === "start"
    ? "Usage: agent daemon start [--foreground] [--host HOST] [--port PORT] [--pid-file PATH] [--control-socket PATH] [--agentd-base-url URL] [--log-level LEVEL] [--log-file PATH]"
    : command === "restart"
      ? "Usage: agent daemon restart [--refresh-servers] [--host HOST] [--port PORT] [--pid-file PATH] [--log-level LEVEL] [--log-file PATH]"
      : `Usage: agent daemon ${command} [--host HOST] [--port PORT] [--pid-file PATH] [--log-level LEVEL] [--log-file PATH]`;
  const behavior = command === "start"
    ? "Starts agentd in the background and waits until it is healthy by default. Use --foreground when a service manager should own the agentd process."
    : command === "restart"
      ? "Stops agentd and starts it in the background, unless a service manager takes over the replacement process. Running OpenCode servers are kept; use --refresh-servers to restart them on the same ports so configuration or environment changes are picked up."
      : undefined;
  process.stdout.write(`${usage}\n${behavior ? `\n${behavior}\n` : ""}\nCommands: start, status, stop, restart, ensure\n`);
}
