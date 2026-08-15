import type { Readable, Writable } from "node:stream";
import { resolve } from "node:path";
import type { PairDevice } from "@mobile-agent/application";
import { resolveAgentdPaths, validateAgentdControlSocketPath } from "@mobile-agent/persistence/paths";

export type PairCommandIo = {
  out: Writable;
  input: Readable;
};

export type PairDisplay = "browser" | "terminal";

export type ParsedPairCommandOptions = {
  controlSocket: string;
  agentdBaseUrl?: string;
  withoutServe: boolean;
  display: PairDisplay;
};

export type ResolvedPairCommandOptions = {
  controlSocket: string;
  agentdBaseUrl: string;
  display: PairDisplay;
};

export type PairDeviceRuntime = {
  useCase: PairDevice;
  close(): void | Promise<void>;
};

export type PairDeviceRuntimeFactory = (
  options: ResolvedPairCommandOptions,
  io: PairCommandIo,
) => Promise<PairDeviceRuntime>;

export type PairAgentdUrlResolver = (input: { withoutServe: boolean; environment: NodeJS.ProcessEnv }) => Promise<string>;

export type PairCommandOptions = {
  env?: NodeJS.ProcessEnv;
  io: PairCommandIo;
  createRuntime: PairDeviceRuntimeFactory;
  resolveAgentdBaseUrl: PairAgentdUrlResolver;
};

export class PairCommandError extends Error {}

/** CLI adapter for the application-level `PairDevice` use case. */
export class PairCommand {
  private readonly env: NodeJS.ProcessEnv;

  public constructor(private readonly options: PairCommandOptions) {
    this.env = { ...process.env, ...options.env };
  }

  public async execute(args: string[]): Promise<number> {
    if (args.includes("-h") || args.includes("--help")) {
      this.write("Usage: agent pair [--open|--terminal] [--without-serve] [--agentd-base-url URL] [--control-socket PATH]\n");
      return 0;
    }

    const parsed = parsePairCommandOptions(args, this.env);
    const agentdBaseUrl = parsed.agentdBaseUrl ?? await this.options.resolveAgentdBaseUrl({
      withoutServe: parsed.withoutServe,
      environment: this.env,
    });
    const runtime = await this.options.createRuntime({ controlSocket: parsed.controlSocket, agentdBaseUrl, display: parsed.display }, this.options.io);
    try {
      const result = await runtime.useCase.execute({
        agentdBaseUrl,
      });
      if (result.status === "approved") {
        this.write(`Approved. deviceId: ${result.deviceId}\n`);
        return 0;
      }
      this.write("Pairing was rejected.\n");
      return 1;
    } finally {
      await runtime.close();
    }
  }

  private write(value: string): void {
    this.options.io.out.write(value);
  }
}

export function parsePairCommandOptions(args: string[], env: NodeJS.ProcessEnv = process.env): ParsedPairCommandOptions {
  let controlSocket = env.AGENTD_CONTROL_SOCKET ?? defaultControlSocket(env);
  let agentdBaseUrl = env.AGENTD_PAIRING_BASE_URL;
  let withoutServe = false;
  let display: PairDisplay = "browser";
  let explicitDisplay: PairDisplay | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--control-socket") controlSocket = resolve(requireValue(argument, args[++index]));
    else if (argument.startsWith("--control-socket=")) controlSocket = resolve(argument.slice("--control-socket=".length));
    else if (argument === "--without-serve") withoutServe = true;
    else if (argument === "--agentd-base-url") agentdBaseUrl = requireValue(argument, args[++index]);
    else if (argument.startsWith("--agentd-base-url=")) agentdBaseUrl = argument.slice("--agentd-base-url=".length);
    else if (argument === "--open") {
      if (explicitDisplay === "terminal") throw new PairCommandError("agent pair options --open and --terminal are mutually exclusive");
      explicitDisplay = "browser";
      display = "browser";
    } else if (argument === "--terminal") {
      if (explicitDisplay === "browser") throw new PairCommandError("agent pair options --open and --terminal are mutually exclusive");
      explicitDisplay = "terminal";
      display = "terminal";
    }
    else throw new PairCommandError(`unknown agent pair option: ${argument}`);
  }

  validateAgentdControlSocketPath(controlSocket);
  return { controlSocket, agentdBaseUrl, withoutServe, display };
}

function defaultControlSocket(env: NodeJS.ProcessEnv): string {
  return resolveAgentdPaths(env).controlSocket;
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new PairCommandError(`${option} requires a value`);
  return value;
}
