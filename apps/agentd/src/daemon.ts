import { createAgentdServer } from "./server.js";

export type AgentdCliOptions = {
  host: string;
  port: number;
};

export function startAgentd(args: string[] = []): ReturnType<typeof createAgentdServer> | undefined {
  const optionsArgs = normalizeStartCommand(args);
  if (optionsArgs.includes("-h") || optionsArgs.includes("--help")) {
    process.stdout.write("Usage: agent daemon start [--host HOST] [--port PORT]\n");
    return undefined;
  }
  const options = parseAgentdOptions(optionsArgs);
  const app = createAgentdServer(options);
  app.start();

  const shutdown = () => {
    app.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return app;
}

function normalizeStartCommand(args: string[]): string[] {
  const [command, ...rest] = args;
  if (!command || command.startsWith("-")) return args;
  if (command === "start") return rest;
  throw new Error(`unknown agent daemon command: ${command}`);
}

function parseAgentdOptions(args: string[]): AgentdCliOptions {
  let host = process.env.AGENTD_HOST ?? "127.0.0.1";
  let port = Number(process.env.AGENTD_PORT ?? 4317);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--host") host = requireValue(argument, args[++index]);
    else if (argument.startsWith("--host=")) host = argument.slice("--host=".length);
    else if (argument === "--port") port = parsePort(argument, requireValue(argument, args[++index]));
    else if (argument.startsWith("--port=")) port = parsePort("--port", argument.slice("--port=".length));
    else {
      throw new Error(`unknown agent daemon option: ${argument}`);
    }
  }

  return { host, port };
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function parsePort(option: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${option} must be between 1 and 65535`);
  return port;
}
