import { createAgentdServer } from "./server.js";

export type AgentdCliOptions = {
  host: string;
  port: number;
  controlSocket?: string;
  webOrigin?: string;
  agentdBaseUrl?: string;
};

export function startAgentd(args: string[] = []): ReturnType<typeof createAgentdServer> | undefined {
  const optionsArgs = normalizeStartCommand(args);
  if (optionsArgs.includes("-h") || optionsArgs.includes("--help")) {
    process.stdout.write("Usage: agent daemon start [--host HOST] [--port PORT] [--control-socket PATH] [--web-origin URL] [--agentd-base-url URL]\n");
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
  let controlSocket = process.env.AGENTD_CONTROL_SOCKET;
  let webOrigin = process.env.AGENTD_WEB_ORIGIN;
  let agentdBaseUrl = process.env.AGENTD_PAIRING_BASE_URL;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--host") host = requireValue(argument, args[++index]);
    else if (argument.startsWith("--host=")) host = argument.slice("--host=".length);
    else if (argument === "--port") port = parsePort(argument, requireValue(argument, args[++index]));
    else if (argument.startsWith("--port=")) port = parsePort("--port", argument.slice("--port=".length));
    else if (argument === "--control-socket") controlSocket = requireValue(argument, args[++index]);
    else if (argument.startsWith("--control-socket=")) controlSocket = argument.slice("--control-socket=".length);
    else if (argument === "--web-origin") webOrigin = requireValue(argument, args[++index]);
    else if (argument.startsWith("--web-origin=")) webOrigin = argument.slice("--web-origin=".length);
    else if (argument === "--agentd-base-url") agentdBaseUrl = requireValue(argument, args[++index]);
    else if (argument.startsWith("--agentd-base-url=")) agentdBaseUrl = argument.slice("--agentd-base-url=".length);
    else {
      throw new Error(`unknown agent daemon option: ${argument}`);
    }
  }

  return { host, port, controlSocket, webOrigin, agentdBaseUrl };
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
