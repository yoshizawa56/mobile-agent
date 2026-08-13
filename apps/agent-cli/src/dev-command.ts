import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runDevCommand(args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const serveProvider = parseDevServeProvider(args);
  const repositoryRoot = findRepositoryRoot(environment.AGENT_REPOSITORY_ROOT ?? process.cwd());
  if (!repositoryRoot) {
    throw new Error("agent dev requires a source checkout containing scripts/dev.mjs");
  }

  const childEnvironment = {
    ...environment,
    ...(serveProvider ? { AGENT_DEV_SERVE_PROVIDER: serveProvider } : {}),
  };
  const child = spawn(environment.AGENT_BUN_BIN ?? "bun", ["scripts/dev.mjs"], {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: "inherit",
  });

  let forwarding = false;
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (forwarding) return;
    forwarding = true;
    child.kill(signal);
  };
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);

  try {
    return await new Promise<number>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolvePromise(code ?? signalExitCode(signal)));
    });
  } finally {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
  }
}

export function parseDevServeProvider(args: string[]): "tailscale" | undefined {
  if (args.length === 0) return undefined;
  const [command, provider, ...rest] = args;
  if (command !== "serve") throw new Error(`unknown agent dev command: ${command}`);
  if (provider !== "tailscale") throw new Error(`unsupported dev serve provider: ${provider ?? "missing"}`);
  if (rest.length > 0) throw new Error(`unknown agent dev option: ${rest[0]}`);
  return provider;
}

function findRepositoryRoot(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "scripts", "dev.mjs"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  try {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    return existsSync(join(sourceRoot, "scripts", "dev.mjs")) ? sourceRoot : undefined;
  } catch {
    return undefined;
  }
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}
