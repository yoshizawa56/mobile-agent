import { EventEmitter } from "node:events";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "bun:test";
import {
  checkWebHealth,
  createDevSupervisor,
  DevRuntimeError,
  formatPortOwners,
  parsePortOwners,
  probeWebSocket,
  resolveDevConfig,
} from "./dev.mjs";

function createFakeRuntime(overrides = {}) {
  const config = {
    agentdHost: "127.0.0.1",
    agentdProbeHost: "127.0.0.1",
    agentdPort: 14_317,
    agentdProxyTarget: "http://127.0.0.1:14317",
    webHost: "127.0.0.1",
    webPort: 15_227,
    repoRoot: "/repo",
    baseEnvironment: { PATH: "/test/bin" },
    readyTimeoutMs: 25,
    shutdownTimeoutMs: 25,
    probeTimeoutMs: 5,
  };
  const ports = new Map();
  const children = [];
  const spawnCalls = [];
  const signals = [];
  const httpRequests = [];
  const websocketRequests = [];
  const logs = [];
  let nextPid = 100;

  const serviceForPort = (port) => port === config.agentdPort ? "agentd" : "web";
  const healthy = (name) => ports.get(name)?.healthy === true;
  const owners = (name) => ports.get(name)?.owners ?? [];

  const inspectPort = async (_host, port) => {
    const name = serviceForPort(port);
    return ports.has(name) ? { available: false, owners: owners(name) } : { available: true, owners: [] };
  };

  const probeHttp = async (url) => {
    const parsed = new URL(url);
    httpRequests.push(parsed.pathname);
    const name = parsed.port === String(config.agentdPort) ? "agentd" : "web";
    if (parsed.pathname === "/health" && healthy("agentd")) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, service: "agentd", protocolVersion: 1 }) };
    }
    if (name === "web" && parsed.pathname === "/" && healthy("web")) {
      return { statusCode: 200, body: "<!doctype html><html><body>dev</body></html>" };
    }
    if (name === "web" && parsed.pathname === "/api/capabilities" && healthy("web") && healthy("agentd")) {
      return { statusCode: 200, body: JSON.stringify({ protocolVersion: 1, features: { terminalWebSocket: true } }) };
    }
    return { statusCode: 503, body: "service unavailable" };
  };

  const probeWebSocket = async (url) => {
    websocketRequests.push(new URL(url).pathname);
    if (!healthy("web") || !healthy("agentd")) throw new Error("WebSocket route unavailable");
    return { statusCode: 101 };
  };

  const spawnProcess = (command, args, options) => {
    const name = command === "bun" ? "agentd" : "web";
    const pid = nextPid++;
    const child = new EventEmitter();
    child.pid = pid;
    child.kill = (signal) => {
      signals.push({ name, pid, signal });
      const current = ports.get(name);
      if (current?.owners.some((owner) => owner.pid === String(pid))) ports.delete(name);
      queueMicrotask(() => child.emit("exit", null, signal));
      return true;
    };
    ports.set(name, { healthy: true, owners: [{ pid: String(pid), command: `${name}-fake` }] });
    children.push(child);
    spawnCalls.push({ command, args, options, name, pid });
    return child;
  };

  const logger = {
    info: (message) => logs.push({ level: "info", message }),
    warn: (message) => logs.push({ level: "warn", message }),
    error: (message) => logs.push({ level: "error", message }),
    log: (message) => logs.push({ level: "log", message }),
  };

  const supervisor = createDevSupervisor({
    config: { ...config, ...overrides.config },
    inspectPort,
    probeHttp,
    probeWebSocket,
    spawnProcess,
    signalProcess: (child, signal) => child.kill(signal),
    sleep: async () => {},
    logger,
  });

  return {
    config,
    ports,
    children,
    spawnCalls,
    signals,
    httpRequests,
    websocketRequests,
    logs,
    supervisor,
  };
}

describe("dev orchestration diagnostics", () => {
  it("assigns a worktree profile and refuses to adopt another runtime", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "mobile-agent-dev-test-"));
    let config;
    try {
      config = resolveDevConfig({ AGENT_DEV_STATE_ROOT: stateRoot }, process.cwd());
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }

    assert.equal(config.adoptExistingServices, false);
    assert.equal(config.baseEnvironment.AGENT_PROFILE, "dev");
    assert.match(config.baseEnvironment.AGENT_WORKTREE_ID, /^[0-9a-f]{16}$/);
    assert.match(config.baseEnvironment.AGENTD_DB_FILE, /worktrees\/[^/]+\/agentd\.sqlite$/);
    assert.equal(config.baseEnvironment.AGENTD_TMUX_SOCKET, undefined);
  });

  it("parses lsof process-field output and formats actionable owners", () => {
    const owners = parsePortOwners("p123\ncnode\np123\ncnode\np456\ncvite\n");

    assert.deepEqual(owners, [
      { pid: "123", command: "node" },
      { pid: "456", command: "vite" },
    ]);
    assert.equal(formatPortOwners(owners), "PID 123 (node), PID 456 (vite)");
  });

  it("verifies HTML, API proxy, and both WebSocket routes", async () => {
    const runtime = createFakeRuntime();
    runtime.ports.set("agentd", { healthy: true, owners: [{ pid: "1", command: "agentd" }] });
    runtime.ports.set("web", { healthy: true, owners: [{ pid: "2", command: "vite" }] });

    const result = await checkWebHealth(runtime.supervisor.config, {
      http: async (url) => {
        const parsed = new URL(url);
        runtime.httpRequests.push(parsed.pathname);
        if (parsed.pathname === "/") return { statusCode: 200, body: "<!doctype html><html></html>" };
        return { statusCode: 200, body: JSON.stringify({ protocolVersion: 1, features: {} }) };
      },
      websocket: async (url) => {
        runtime.websocketRequests.push(new URL(url).pathname);
        return { statusCode: 101 };
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(runtime.httpRequests, ["/", "/api/capabilities"]);
    assert.deepEqual(runtime.websocketRequests, ["/terminal", "/events"]);
  });

  it("probes WebSocket URLs through HTTP and accepts a 101 response event", async () => {
    let requestedUrl;
    const result = await probeWebSocket("ws://127.0.0.1:14317/terminal", {
      request: (url) => {
        requestedUrl = url;
        const request = new EventEmitter();
        request.destroy = () => {};
        request.end = () => queueMicrotask(() => request.emit("response", {
          statusCode: 101,
          resume: () => {},
        }));
        return request;
      },
    });

    assert.equal(requestedUrl.protocol, "http:");
    assert.equal(result.statusCode, 101);
  });

  it("starts the two services, reports readiness, and kills their process groups", async () => {
    const runtime = createFakeRuntime();

    await runtime.supervisor.start();

    assert.equal(runtime.supervisor.state, "running");
    assert.deepEqual(runtime.spawnCalls.map((call) => call.name), ["agentd", "web"]);
    assert.deepEqual(runtime.spawnCalls.map((call) => call.command), ["bun", "node"]);
    assert.deepEqual(runtime.spawnCalls.map((call) => call.args), [
      ["--watch", "src/index.ts"],
      ["./node_modules/vite/bin/vite.js"],
    ]);
    assert.deepEqual(runtime.spawnCalls.map((call) => call.options.cwd), ["/repo/apps/agentd", "/repo/apps/web"]);
    assert.equal(runtime.spawnCalls.every((call) => call.options.detached === true), true);
    assert.equal(runtime.spawnCalls.every((call) => call.options.shell === false), true);
    assert.equal(runtime.websocketRequests.join(","), "/terminal,/events");
    assert.equal(runtime.logs.some(({ message }) => message.includes("[dev] ready:")), true);

    await runtime.supervisor.stop("test", 0);

    assert.equal(runtime.supervisor.state, "stopped");
    assert.deepEqual(runtime.signals.map(({ name, signal }) => `${name}:${signal}`), ["agentd:SIGTERM", "web:SIGTERM"]);
    assert.equal(runtime.ports.size, 0);
  });

  it("reuses healthy listeners without claiming or killing them", async () => {
    const runtime = createFakeRuntime();
    runtime.ports.set("agentd", { healthy: true, owners: [{ pid: "201", command: "agentd" }] });
    runtime.ports.set("web", { healthy: true, owners: [{ pid: "202", command: "vite" }] });

    await runtime.supervisor.start();
    assert.equal(runtime.spawnCalls.length, 0);
    assert.equal(runtime.logs.some(({ message }) => message.includes("reusing healthy agentd")), true);
    assert.equal(runtime.logs.some(({ message }) => message.includes("reusing healthy web")), true);

    await runtime.supervisor.stop("test", 0);
    assert.equal(runtime.signals.length, 0);
  });

  it("does not adopt a healthy listener for a worktree profile", async () => {
    const runtime = createFakeRuntime({ config: { adoptExistingServices: false, readyTimeoutMs: 5 } });
    runtime.ports.set("agentd", { healthy: true, owners: [{ pid: "401", command: "other-worktree-agentd" }] });

    await assert.rejects(
      runtime.supervisor.start(),
      (error) => {
        assert.equal(error instanceof DevRuntimeError, true);
        assert.match(error.message, /adoption is disabled/);
        assert.match(error.message, /PID 401 \(other-worktree-agentd\)/);
        return true;
      },
    );
    assert.equal(runtime.spawnCalls.length, 0);
  });

  it("fails a foreign port conflict with the owner and recovery command", async () => {
    const runtime = createFakeRuntime({ config: { readyTimeoutMs: 5 } });
    runtime.ports.set("agentd", { healthy: false, owners: [{ pid: "301", command: "stale-agentd" }] });

    await assert.rejects(
      runtime.supervisor.start(),
      (error) => {
        assert.equal(error instanceof DevRuntimeError, true);
        assert.match(error.message, /PID 301 \(stale-agentd\)/);
        assert.match(error.message, /AGENTD_PORT/);
        assert.match(error.message, /lsof -nP/);
        return true;
      },
    );
    assert.equal(runtime.spawnCalls.length, 0);
  });

  it("stops the stack when an owned service exits instead of restarting it", async () => {
    const runtime = createFakeRuntime();
    await runtime.supervisor.start();
    const webCall = runtime.spawnCalls.find((call) => call.name === "web");
    const webChild = runtime.children.find((child) => child.pid === webCall.pid);

    runtime.ports.delete("web");
    webChild.emit("exit", 1, null);
    const result = await runtime.supervisor.waitForExit();

    assert.deepEqual(runtime.spawnCalls.map((call) => call.name), ["agentd", "web"]);
    assert.equal(result.exitCode, 1);
    assert.equal(runtime.supervisor.state, "stopped");
    assert.equal(runtime.logs.some(({ message }) => message.includes("automatic restart is disabled")), true);
    assert.equal(runtime.signals.some(({ name, signal }) => name === "agentd" && signal === "SIGTERM"), true);
  });

  it("stops its own process group without killing a replacement listener", async () => {
    const runtime = createFakeRuntime();
    await runtime.supervisor.start();
    const webChild = runtime.spawnCalls.find((call) => call.name === "web");

    runtime.ports.set("web", { healthy: true, owners: [{ pid: "999", command: "replacement" }] });
    await runtime.supervisor.stop("test", 0);
    const result = await runtime.supervisor.waitForExit();

    assert.equal(result.exitCode, 0);
    assert.equal(runtime.supervisor.state, "stopped");
    assert.equal(runtime.signals.some(({ pid }) => pid === webChild.pid), true);
    assert.deepEqual(runtime.ports.get("web")?.owners, [{ pid: "999", command: "replacement" }]);
    assert.equal(runtime.logs.some(({ message }) => message.includes("still occupied by PID 999 (replacement)")), true);
  });
});
