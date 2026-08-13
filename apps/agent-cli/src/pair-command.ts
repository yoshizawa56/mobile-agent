import { homedir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { PairDevice } from "@mobile-agent/application";

export type PairCommandIo = {
  out: Writable;
  input: Readable;
};

export type ParsedPairCommandOptions = {
  controlSocket: string;
  webOrigin: string;
  agentdBaseUrl: string;
};

export type PairDeviceRuntime = {
  useCase: PairDevice;
  close(): void;
};

export type PairDeviceRuntimeFactory = (
  options: ParsedPairCommandOptions,
  io: PairCommandIo,
) => Promise<PairDeviceRuntime>;

export type PairCommandOptions = {
  env?: NodeJS.ProcessEnv;
  io: PairCommandIo;
  createRuntime: PairDeviceRuntimeFactory;
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
      this.write("Usage: agent pair [--web-origin URL] [--agentd-base-url URL] [--control-socket PATH]\n");
      return 0;
    }

    const parsed = parsePairCommandOptions(args, this.env);
    const runtime = await this.options.createRuntime(parsed, this.options.io);
    try {
      const result = await runtime.useCase.execute({
        webOrigin: parsed.webOrigin,
        agentdBaseUrl: parsed.agentdBaseUrl,
      });
      if (result.status === "approved") {
        this.write(`承認しました。deviceId: ${result.deviceId}\n`);
        return 0;
      }
      this.write("ペアリングを拒否しました。\n");
      return 1;
    } finally {
      runtime.close();
    }
  }

  private write(value: string): void {
    this.options.io.out.write(value);
  }
}

export function parsePairCommandOptions(args: string[], env: NodeJS.ProcessEnv = process.env): ParsedPairCommandOptions {
  let controlSocket = env.AGENTD_CONTROL_SOCKET ?? defaultControlSocket(env);
  let webOrigin = env.AGENTD_WEB_ORIGIN ?? "http://localhost:5173";
  let agentdBaseUrl = env.AGENTD_PAIRING_BASE_URL ?? "http://127.0.0.1:4317";

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--control-socket") controlSocket = requireValue(argument, args[++index]);
    else if (argument.startsWith("--control-socket=")) controlSocket = argument.slice("--control-socket=".length);
    else if (argument === "--web-origin") webOrigin = requireValue(argument, args[++index]);
    else if (argument.startsWith("--web-origin=")) webOrigin = argument.slice("--web-origin=".length);
    else if (argument === "--agentd-base-url") agentdBaseUrl = requireValue(argument, args[++index]);
    else if (argument.startsWith("--agentd-base-url=")) agentdBaseUrl = argument.slice("--agentd-base-url=".length);
    else throw new PairCommandError(`unknown agent pair option: ${argument}`);
  }

  return { controlSocket, webOrigin, agentdBaseUrl };
}

function defaultControlSocket(env: NodeJS.ProcessEnv): string {
  const databaseFile = env.AGENTD_DB_FILE ?? env.AGENT_DATABASE_FILE;
  return `${databaseFile && databaseFile !== ":memory:" ? databaseFile : join(homedir(), ".local", "state", "mobile-agent", "agentd")}.control.sock`;
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new PairCommandError(`${option} requires a value`);
  return value;
}
