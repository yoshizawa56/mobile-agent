import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { runAgentdCommand } from "@mobile-agent/agentd/daemon";
import { errorFields, errorMessage, parseLogLevel, type Logger, type LogLevel } from "@mobile-agent/logging";
import { buildServeArgs, buildServeHttpUrl, buildTailscaleInvocation, normalizeTailscaleStdout, parseTailscaleHostname } from "@mobile-agent/tailscale";

const execFile = promisify(execFileCallback);
const tailscaleCommandTimeoutMs = 15_000;

export type ServeCommandOptions = {
  provider: "tailscale";
  agentdHost: string;
  agentdPort: number;
  externalPort: number;
  pidFile?: string;
  tailscaleBinary: string;
  hostname?: string;
  logLevel: LogLevel;
  logFile?: string;
};

export type ServeCommandDependencies = {
  ensureAgentd?: (options: ServeCommandOptions) => Promise<void>;
  runCommand?: CommandRunner;
  out?: (value: string) => void;
  err?: (value: string) => void;
  logger?: Logger;
};

export type TailscaleServeResult = {
  options: ServeCommandOptions;
  serveArgs: string[];
  hostname?: string;
  url?: string;
  stdout: string;
  stderr: string;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

export function serveUsage(): string {
  return [
    "Usage: agent serve tailscale [--port PORT] [--agentd-port PORT] [--agentd-host HOST] [--log-level LEVEL] [--log-file PATH]",
    "",
    "Ensures agentd is running in the background, then configures persistent Tailscale Serve with --bg.",
    "Use --log-level LEVEL and --log-file PATH to configure the managed agentd process.",
  ].join("\n");
}

export function parseServeOptions(args: string[], environment: NodeJS.ProcessEnv = process.env): ServeCommandOptions {
  const [provider, ...rest] = args;
  if (provider !== "tailscale") {
    if (!provider || provider === "--help" || provider === "-h") {
      throw new Error(serveUsage());
    }
    throw new Error(`unsupported serve provider: ${provider}`);
  }
  if (rest.includes("-h") || rest.includes("--help")) throw new Error(serveUsage());

  let externalPort = parsePort("AGENT_SERVE_PORT", environment.AGENT_SERVE_PORT ?? "8444");
  let agentdPort = parsePort("AGENTD_PORT", environment.AGENTD_PORT ?? "4317");
  let agentdHost = environment.AGENTD_HOST ?? "127.0.0.1";
  let pidFile: string | undefined;
  let logLevel = parseLogLevel(environment.AGENT_LOG_LEVEL, "info");
  let logFile = environment.AGENT_LOG_FILE ? resolve(environment.AGENT_LOG_FILE) : undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (argument === "--port" || argument === "--https-port" || argument === "--external-port") {
      externalPort = parsePort(argument, requireValue(argument, rest[++index]));
    } else if (argument.startsWith("--port=") || argument.startsWith("--https-port=") || argument.startsWith("--external-port=")) {
      const option = argument.slice(0, argument.indexOf("="));
      externalPort = parsePort(option, argument.slice(argument.indexOf("=") + 1));
    } else if (argument === "--agentd-port") {
      agentdPort = parsePort(argument, requireValue(argument, rest[++index]));
    } else if (argument.startsWith("--agentd-port=")) {
      agentdPort = parsePort("--agentd-port", argument.slice("--agentd-port=".length));
    } else if (argument === "--agentd-host") {
      agentdHost = requireValue(argument, rest[++index]);
    } else if (argument.startsWith("--agentd-host=")) {
      agentdHost = argument.slice("--agentd-host=".length);
    } else if (argument === "--pid-file") {
      pidFile = requireValue(argument, rest[++index]);
    } else if (argument.startsWith("--pid-file=")) {
      pidFile = argument.slice("--pid-file=".length);
    } else if (argument === "--log-level") {
      logLevel = parseServeLogLevel(argument, requireValue(argument, rest[++index]));
    } else if (argument.startsWith("--log-level=")) {
      logLevel = parseServeLogLevel("--log-level", argument.slice("--log-level=".length));
    } else if (argument === "--log-file") {
      logFile = resolve(requireValue(argument, rest[++index]));
    } else if (argument.startsWith("--log-file=")) {
      logFile = resolve(argument.slice("--log-file=".length));
    } else {
      throw new Error(`unknown serve option: ${argument}`);
    }
  }

  return {
    provider,
    agentdHost,
    agentdPort,
    externalPort,
    pidFile,
    tailscaleBinary: environment.TAILSCALE_BIN ?? "tailscale",
    hostname: environment.AGENT_TAILSCALE_HOSTNAME,
    logLevel,
    logFile,
  };
}

export async function runServeCommand(
  args: string[],
  dependencies: ServeCommandDependencies = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const out = dependencies.out ?? ((value: string) => process.stdout.write(value));
  const err = dependencies.err ?? ((value: string) => process.stderr.write(value));
  const logger = dependencies.logger;
  if (args.includes("-h") || args.includes("--help")) {
    out(`${serveUsage()}\n`);
    return 0;
  }
  const options = parseServeOptions(args, environment);
  const result = await ensureTailscaleServe(options, {
    ensureAgentd: dependencies.ensureAgentd,
    runCommand: dependencies.runCommand,
    logger,
  }, environment);
  if (result.stderr) err(result.stderr);
  out(`agent serve tailscale: ${result.url ?? `HTTPS port ${options.externalPort}`} -> ${localAgentdUrl(options.agentdHost, options.agentdPort)}\n`);
  if (result.stdout) out(result.stdout);
  return 0;
}

export async function ensureTailscaleServe(
  options: ServeCommandOptions,
  dependencies: Pick<ServeCommandDependencies, "ensureAgentd" | "runCommand" | "logger"> = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TailscaleServeResult> {
  const ensureAgentd = dependencies.ensureAgentd ?? ensureLocalAgentd;
  const runCommand = dependencies.runCommand ?? runExternalCommand;
  const logger = dependencies.logger;
  const startedAt = Date.now();
  logger?.debug("serve.started", {
    agentdHost: options.agentdHost,
    agentdPort: options.agentdPort,
    externalPort: options.externalPort,
    logLevel: options.logLevel,
    logFileConfigured: Boolean(options.logFile),
  });
  const agentdStartedAt = Date.now();
  logger?.debug("agentd.ensure_started", { host: options.agentdHost, port: options.agentdPort });
  try {
    await ensureAgentd(options);
    logger?.debug("agentd.ensure_finished", { durationMs: Date.now() - agentdStartedAt });
  } catch (error) {
    logger?.debug("agentd.ensure_failed", { durationMs: Date.now() - agentdStartedAt, ...errorFields(error) });
    throw error;
  }

  const serveArgs = buildServeArgs({ localPort: options.agentdPort, externalPort: options.externalPort });
  const commandStartedAt = Date.now();
  logger?.debug("serve.subprocess_starting", { kind: "tailscale", executable: options.tailscaleBinary, argumentCount: serveArgs.length });
  const result = await runCommand(options.tailscaleBinary, serveArgs, { env: environment });
  logger?.debug("serve.subprocess_finished", { kind: "tailscale", durationMs: Date.now() - commandStartedAt });

  let hostname = options.hostname;
  if (!hostname) {
    const statusStartedAt = Date.now();
    try {
      logger?.debug("serve.hostname_lookup_started", { executable: options.tailscaleBinary });
      hostname = parseTailscaleHostname((await runCommand(options.tailscaleBinary, ["status", "--json"], { env: environment })).stdout);
      logger?.debug("serve.hostname_lookup_finished", { durationMs: Date.now() - statusStartedAt, resolved: Boolean(hostname) });
    } catch (error) {
      logger?.debug("serve.hostname_lookup_failed", { durationMs: Date.now() - statusStartedAt, ...errorFields(error) });
    }
  }
  const url = hostname ? buildServeHttpUrl(hostname, options.externalPort) : undefined;
  logger?.debug("serve.finished", { durationMs: Date.now() - startedAt, hostnameResolved: Boolean(hostname) });
  return { options, serveArgs, hostname, url, stdout: result.stdout, stderr: result.stderr };
}

export async function ensureLocalAgentd(options: ServeCommandOptions): Promise<void> {
  const args = [
    "ensure",
    "--host", options.agentdHost,
    "--port", String(options.agentdPort),
    "--log-level", options.logLevel,
  ];
  if (options.pidFile) args.push("--pid-file", options.pidFile);
  if (options.logFile) args.push("--log-file", options.logFile);
  await runAgentdCommand(args);
}

export function localAgentdUrl(host: string, port: number): string {
  const normalizedHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const urlHost = normalizedHost.includes(":") && !normalizedHost.startsWith("[") ? `[${normalizedHost}]` : normalizedHost;
  return `http://${urlHost}:${port}`;
}

async function runExternalCommand(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const invocation = buildTailscaleInvocation(command, args, options.env);
    const result = await execFile(invocation.command, invocation.args, {
      env: invocation.environment,
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: tailscaleCommandTimeoutMs,
    });
    return { ...result, stdout: normalizeTailscaleStdout(result.stdout, invocation) };
  } catch (error) {
    throw new Error(`could not run ${command}: ${errorMessage(error)}`, { cause: error });
  }
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function parsePort(option: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${option} must be between 1 and 65535`);
  }
  return port;
}

function parseServeLogLevel(option: string, value: string): LogLevel {
  if (value !== "error" && value !== "warn" && value !== "info" && value !== "debug") {
    throw new Error(`${option} must be one of error, warn, info, or debug`);
  }
  return value;
}
