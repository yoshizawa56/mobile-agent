import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { runAgentdCommand } from "@mobile-agent/agentd/daemon";
import { buildServeArgs, buildServeHttpUrl, parseTailscaleHostname } from "@mobile-agent/tailscale";

const execFile = promisify(execFileCallback);

export type ServeCommandOptions = {
  provider: "tailscale";
  agentdHost: string;
  agentdPort: number;
  externalPort: number;
  pidFile?: string;
  tailscaleBinary: string;
  hostname?: string;
};

export type ServeCommandDependencies = {
  ensureAgentd?: (options: ServeCommandOptions) => Promise<void>;
  runCommand?: CommandRunner;
  out?: (value: string) => void;
  err?: (value: string) => void;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

export function parseServeOptions(args: string[], environment: NodeJS.ProcessEnv = process.env): ServeCommandOptions {
  const [provider, ...rest] = args;
  if (provider !== "tailscale") {
    if (!provider || provider === "--help" || provider === "-h") {
      throw new Error("Usage: agent serve tailscale [--port PORT] [--agentd-port PORT] [--agentd-host HOST]");
    }
    throw new Error(`unsupported serve provider: ${provider}`);
  }

  let externalPort = parsePort("AGENT_SERVE_PORT", environment.AGENT_SERVE_PORT ?? "8444");
  let agentdPort = parsePort("AGENTD_PORT", environment.AGENTD_PORT ?? "4317");
  let agentdHost = environment.AGENTD_HOST ?? "127.0.0.1";
  let pidFile: string | undefined;

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
  };
}

export async function runServeCommand(
  args: string[],
  dependencies: ServeCommandDependencies = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const options = parseServeOptions(args, environment);
  const out = dependencies.out ?? ((value: string) => process.stdout.write(value));
  const err = dependencies.err ?? ((value: string) => process.stderr.write(value));
  const ensureAgentd = dependencies.ensureAgentd ?? ensureLocalAgentd;
  const runCommand = dependencies.runCommand ?? runExternalCommand;

  await ensureAgentd(options);

  const serveArgs = buildServeArgs({
    localPort: options.agentdPort,
    externalPort: options.externalPort,
  });
  const result = await runCommand(options.tailscaleBinary, serveArgs, { env: environment });
  if (result.stderr) err(result.stderr);

  let hostname = options.hostname;
  if (!hostname) {
    try {
      hostname = parseTailscaleHostname(
        (await runCommand(options.tailscaleBinary, ["status", "--json"], { env: environment })).stdout,
      );
    } catch {
      // The Serve upsert already succeeded. A hostname is only needed for the
      // convenience output, so leave it unavailable when status is blocked.
    }
  }
  const url = hostname ? buildServeHttpUrl(hostname, options.externalPort) : undefined;
  out(`agent serve tailscale: ${url ?? `HTTPS port ${options.externalPort}`} -> http://127.0.0.1:${options.agentdPort}\n`);
  if (result.stdout) out(result.stdout);
  return 0;
}

async function ensureLocalAgentd(options: ServeCommandOptions): Promise<void> {
  const args = [
    "ensure",
    "--host", options.agentdHost,
    "--port", String(options.agentdPort),
  ];
  if (options.pidFile) args.push("--pid-file", options.pidFile);
  await runAgentdCommand(args);
}

async function runExternalCommand(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFile(command, args, {
      env: options.env,
      encoding: "utf8",
      maxBuffer: 256 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not run ${command} ${args.join(" ")}: ${detail}`, { cause: error });
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
