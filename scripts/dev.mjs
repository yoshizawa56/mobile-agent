#!/usr/bin/env bun
import { spawn } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";

const agentdHost = process.env.AGENTD_HOST ?? "127.0.0.1";
const agentdPort = readPort("AGENTD_PORT", 4317);
const webHost = process.env.VITE_DEV_HOST ?? "0.0.0.0";
const webPort = readPort("VITE_DEV_PORT", 5227);
const agentdProxyHost = agentdHost === "0.0.0.0" || agentdHost === "::" ? "127.0.0.1" : agentdHost;
const agentdProbeHost = agentdProxyHost;
const repoRoot = process.cwd();
const children = [];
let shuttingDown = false;

await assertPortAvailable("agentd", agentdHost, agentdPort, "AGENTD_PORT");
await assertPortAvailable("web", webHost, webPort, "VITE_DEV_PORT");

const baseEnvironment = {
  ...process.env,
};

const agentd = startService(
  "agentd",
  "bun",
  ["--watch", "src/index.ts"],
  resolve(repoRoot, "apps/agentd"),
  {
    ...baseEnvironment,
    AGENTD_HOST: agentdHost,
    AGENTD_PORT: String(agentdPort),
  },
);

try {
  await waitForPort(agentdProbeHost, agentdPort, 10_000);
} catch (error) {
  stopAll(1);
  throw error;
}

startService(
  "web",
  "node",
  ["./node_modules/vite/bin/vite.js"],
  resolve(repoRoot, "apps/web"),
  {
    ...baseEnvironment,
    VITE_DEV_HOST: webHost,
    VITE_DEV_PORT: String(webPort),
    VITE_AGENTD_PROXY_TARGET: process.env.VITE_AGENTD_PROXY_TARGET ?? `http://${agentdProxyHost}:${agentdPort}`,
  },
);

function startService(name, command, args, cwd, environment) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`[dev] ${name} failed to start: ${error.message}`);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`[dev] ${name} stopped with ${reason}`);
    stopAll(code ?? 1);
  });
  return child;
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
  }, 2_000).unref();
}

process.once("SIGINT", () => stopAll(0));
process.once("SIGTERM", () => stopAll(0));

function readPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

async function assertPortAvailable(name, host, port, environmentVariable) {
  if (!(await isPortAvailable(host, port))) {
    throw new Error(`[dev] ${name} port ${host}:${port} is already in use. Stop that process or set ${environmentVariable} to another port.`);
  }
}

function isPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function waitForPort(host, port, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`[dev] agentd did not listen on ${host}:${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}
