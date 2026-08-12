#!/usr/bin/env node
import { execFile, spawn as spawnChild } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DEV_CONFIG = {
  agentdHost: "127.0.0.1",
  agentdPort: 4317,
  webHost: "0.0.0.0",
  webPort: 5227,
  readyTimeoutMs: 15_000,
  shutdownTimeoutMs: 2_000,
  probeTimeoutMs: 1_500,
};

const scriptPath = fileURLToPath(import.meta.url);

export class DevRuntimeError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "DevRuntimeError";
    this.service = options.service;
  }
}

export function readPort(name, fallback, environment = process.env) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new DevRuntimeError(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

function readDuration(name, fallback, environment) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new DevRuntimeError(`${name} must be a positive integer number of milliseconds`);
  }
  return value;
}

export function resolveDevConfig(environment = process.env, cwd = process.cwd()) {
  const agentdHost = environment.AGENTD_HOST ?? DEFAULT_DEV_CONFIG.agentdHost;
  const agentdPort = readPort("AGENTD_PORT", DEFAULT_DEV_CONFIG.agentdPort, environment);
  const webHost = environment.VITE_DEV_HOST ?? DEFAULT_DEV_CONFIG.webHost;
  const webPort = readPort("VITE_DEV_PORT", DEFAULT_DEV_CONFIG.webPort, environment);
  const agentdProbeHost = probeHostForBind(agentdHost);
  const agentdProxyHost = agentdProbeHost;

  return {
    ...DEFAULT_DEV_CONFIG,
    repoRoot: cwd,
    baseEnvironment: { ...environment },
    agentdHost,
    agentdPort,
    agentdProbeHost,
    agentdProxyTarget: environment.VITE_AGENTD_PROXY_TARGET ?? `http://${formatHost(agentdProxyHost)}:${agentdPort}`,
    webHost,
    webPort,
    readyTimeoutMs: readDuration("MOBILE_AGENT_DEV_READY_TIMEOUT_MS", DEFAULT_DEV_CONFIG.readyTimeoutMs, environment),
    shutdownTimeoutMs: readDuration("MOBILE_AGENT_DEV_SHUTDOWN_TIMEOUT_MS", DEFAULT_DEV_CONFIG.shutdownTimeoutMs, environment),
  };
}

function probeHostForBind(host) {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "::1";
  return host;
}

function formatHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function endpoint(host, port, pathname = "/") {
  return `http://${formatHost(host)}:${port}${pathname}`;
}

function browserHost(host) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function serviceDefinitions(config) {
  return {
    agentd: {
      name: "agentd",
      host: config.agentdProbeHost,
      port: config.agentdPort,
      environmentVariable: "AGENTD_PORT",
      url: endpoint(config.agentdProbeHost, config.agentdPort),
      healthUrl: endpoint(config.agentdProbeHost, config.agentdPort, "/health"),
      args: ["--filter", "@mobile-agent/agentd", "dev"],
      environment: {
        ...config.baseEnvironment,
        AGENTD_HOST: config.agentdHost,
        AGENTD_PORT: String(config.agentdPort),
      },
    },
    web: {
      name: "web",
      host: browserHost(config.webHost),
      port: config.webPort,
      environmentVariable: "VITE_DEV_PORT",
      url: endpoint(browserHost(config.webHost), config.webPort),
      args: ["--filter", "@mobile-agent/web", "dev"],
      environment: {
        ...config.baseEnvironment,
        VITE_DEV_HOST: config.webHost,
        VITE_DEV_PORT: String(config.webPort),
        VITE_AGENTD_PROXY_TARGET: config.agentdProxyTarget,
      },
    },
  };
}

export function isPortAvailable(host, port) {
  return new Promise((resolveResult, reject) => {
    const server = createServer();
    const onError = (error) => {
      server.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE") {
        resolveResult(false);
        return;
      }
      reject(error);
    };
    const onListening = () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolveResult(true);
      });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port });
  });
}

export function parsePortOwners(output) {
  const owners = [];
  let current;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      if (current?.pid) owners.push(current);
      current = { pid: line.slice(1) };
      continue;
    }
    if (line.startsWith("c") && current) current.command = line.slice(1);
  }
  if (current?.pid) owners.push(current);

  const unique = new Map();
  for (const owner of owners) unique.set(`${owner.pid}:${owner.command ?? ""}`, owner);
  return [...unique.values()];
}

export function findPortOwners(port, execFileImplementation = execFile) {
  return new Promise((resolveResult) => {
    execFileImplementation(
      "lsof",
      ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"],
      { encoding: "utf8", maxBuffer: 64 * 1024 },
      (_error, stdout = "") => resolveResult(parsePortOwners(stdout)),
    );
  });
}

export async function inspectPort(host, port, options = {}) {
  const available = await isPortAvailable(host, port);
  if (available) return { available: true, owners: [] };

  const lookupOwners = options.lookupOwners ?? findPortOwners;
  let owners = [];
  try {
    owners = await lookupOwners(port);
  } catch {
    // Port ownership is helpful diagnostics, but an unavailable lsof command
    // must not prevent the health check from producing its recovery advice.
  }
  return { available: false, owners };
}

export function probeHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_CONFIG.probeTimeoutMs;
  const parsed = new URL(url);
  const request = (parsed.protocol === "https:" ? httpsRequest : httpRequest)(parsed, {
    method: "GET",
    headers: { accept: "application/json, text/html;q=0.9" },
  });

  return new Promise((resolveResult, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      request.destroy();
      finish(reject, new Error(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.once("error", (error) => finish(reject, error));
    request.once("response", (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        finish(resolveResult, {
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: chunks.join(""),
        });
      });
      response.once("error", (error) => finish(reject, error));
    });
    request.end();
  });
}

export function probeWebSocket(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_CONFIG.probeTimeoutMs;
  const parsed = new URL(url);
  const request = (parsed.protocol === "wss:" ? httpsRequest : httpRequest)(parsed, {
    method: "GET",
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
  });

  return new Promise((resolveResult, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      request.destroy();
      finish(reject, new Error(`WebSocket upgrade timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.once("error", (error) => finish(reject, error));
    request.once("upgrade", (response, socket) => {
      const statusCode = response.statusCode ?? 0;
      socket.destroy();
      if (statusCode !== 101) {
        finish(reject, new Error(`WebSocket upgrade returned HTTP ${statusCode}`));
        return;
      }
      finish(resolveResult, { statusCode });
    });
    request.once("response", (response) => {
      response.resume();
      finish(reject, new Error(`WebSocket route returned HTTP ${response.statusCode ?? 0} instead of 101`));
    });
    request.end();
  });
}

function jsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function responseSummary(response) {
  const body = response?.body?.replace(/\s+/g, " ").trim() ?? "no response body";
  return `HTTP ${response?.statusCode ?? 0}: ${body.slice(0, 180)}`;
}

function readyHealth(detail, evidence = {}) {
  return { ok: true, detail, evidence };
}

function failedHealth(detail, cause) {
  return { ok: false, detail, cause };
}

export async function checkAgentdHealth(config, request = probeHttp) {
  try {
    const response = await request(endpoint(config.agentdProbeHost, config.agentdPort, "/health"), {
      timeoutMs: config.probeTimeoutMs,
    });
    if (response.statusCode !== 200) return failedHealth(`agentd /health returned ${responseSummary(response)}`);

    const body = jsonBody(response.body);
    if (body?.ok !== true || body?.service !== "agentd" || body?.protocolVersion !== 1) {
      return failedHealth(`agentd /health returned an unexpected payload: ${responseSummary(response)}`);
    }
    return readyHealth("HTTP /health is responding with protocol version 1", body);
  } catch (error) {
    return failedHealth(`agentd health probe failed: ${errorMessage(error)}`, error);
  }
}

export async function checkWebHealth(config, requests = {}) {
  const request = requests.http ?? probeHttp;
  const requestWebSocket = requests.websocket ?? probeWebSocket;
  let root;
  try {
    root = await request(endpoint(browserHost(config.webHost), config.webPort, "/"), {
      timeoutMs: config.probeTimeoutMs,
    });
  } catch (error) {
    return failedHealth(`web HTML probe failed: ${errorMessage(error)}`, error);
  }
  if (root.statusCode !== 200 || !/<(?:!doctype\s+html|html\b)/i.test(root.body ?? "")) {
    return failedHealth(`web / did not return the Vite HTML shell: ${responseSummary(root)}`);
  }

  let capabilities;
  try {
    capabilities = await request(endpoint(browserHost(config.webHost), config.webPort, "/api/capabilities"), {
      timeoutMs: config.probeTimeoutMs,
    });
  } catch (error) {
    return failedHealth(`web /api proxy probe failed: ${errorMessage(error)}`, error);
  }
  const capabilitiesBody = jsonBody(capabilities.body);
  if (
    capabilities.statusCode !== 200
    || capabilitiesBody?.protocolVersion !== 1
    || typeof capabilitiesBody?.features !== "object"
  ) {
    return failedHealth(`web /api/capabilities did not reach a healthy agentd: ${responseSummary(capabilities)}`);
  }

  for (const path of ["/terminal", "/events"]) {
    try {
      await requestWebSocket(`ws://${formatHost(browserHost(config.webHost))}:${config.webPort}${path}`, {
        timeoutMs: config.probeTimeoutMs,
      });
    } catch (error) {
      return failedHealth(`web ${path} WebSocket proxy probe failed: ${errorMessage(error)}`, error);
    }
  }

  return readyHealth("HTML, /api proxy, /terminal WebSocket, and /events WebSocket are ready", {
    capabilities: capabilitiesBody,
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOwners(owners) {
  return (owners ?? [])
    .map((owner) => ({ pid: String(owner.pid), command: owner.command ?? "unknown" }))
    .sort((left, right) => `${left.pid}:${left.command}`.localeCompare(`${right.pid}:${right.command}`));
}

function ownersEqual(left, right) {
  const normalizedLeft = normalizeOwners(left);
  const normalizedRight = normalizeOwners(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((owner, index) => {
      const other = normalizedRight[index];
      return owner.pid === other.pid && owner.command === other.command;
    });
}

export function formatPortOwners(owners) {
  const normalized = normalizeOwners(owners);
  if (!normalized.length) return "owner unavailable";
  return normalized.map((owner) => `PID ${owner.pid} (${owner.command})`).join(", ");
}

function recoveryHint(definition) {
  return `lsof -nP -iTCP:${definition.port} -sTCP:LISTEN; stop the owning process or set ${definition.environmentVariable} to another free port`;
}

function portDescription(definition, inspection) {
  if (inspection.available) return `${definition.name} port ${definition.host}:${definition.port} is not listening`;
  return `${definition.name} port ${definition.host}:${definition.port} is owned by ${formatPortOwners(inspection.owners)}`;
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function signalProcess(child, signal, platform = process.platform) {
  if (!child?.pid) return false;

  if (platform === "win32" && signal === "SIGKILL") {
    const killer = spawnChild("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    killer.unref?.();
    return true;
  }

  if (platform !== "win32") {
    // Detached children are process-group leaders. Do not fall back to a
    // reused PID if the group has already disappeared.
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  }

  try {
    child.kill(signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolveResult) => setTimeout(resolveResult, milliseconds));
}

function logWith(logger, level, message) {
  const method = logger?.[level] ?? logger?.log ?? console.log;
  method.call(logger ?? console, message);
}

export function createDevSupervisor(options = {}) {
  return new DevSupervisor(options);
}

class DevSupervisor {
  constructor(options) {
    this.config = options.config ?? resolveDevConfig();
    this.logger = options.logger ?? console;
    this.spawnProcess = options.spawnProcess ?? spawnChild;
    this.inspectPort = options.inspectPort ?? ((host, port) => inspectPort(host, port));
    this.probeHttp = options.probeHttp ?? probeHttp;
    this.probeWebSocket = options.probeWebSocket ?? probeWebSocket;
    this.sleep = options.sleep ?? delay;
    this.signalProcess = options.signalProcess ?? signalProcess;
    this.services = serviceDefinitions(this.config);
    this.records = new Map();
    this.state = "created";
    this.failure = undefined;
    this.resolveExit = undefined;
    this.exitPromise = new Promise((resolveResult) => {
      this.resolveExit = resolveResult;
    });
    this.stopPromise = undefined;
  }

  async run() {
    await this.start();
    return this.waitForExit();
  }

  async start() {
    if (this.state !== "created") return this;
    this.state = "starting";
    this.log("info", "[dev] starting local stack (Tailscale Serve is opt-in)");
    this.log("info", `[dev] agentd target: ${this.services.agentd.url}`);
    this.log("info", `[dev] web target: ${this.services.web.url} (proxy ${this.config.agentdProxyTarget})`);

    try {
      await this.ensureService("agentd");
      if (this.state !== "starting") return this;
      await this.ensureService("web");
      if (this.state !== "starting") return this;
      this.state = "running";
      this.log("info", `[dev] ready: ${this.services.agentd.url}/health is healthy`);
      this.log("info", `[dev] ready: ${this.services.web.url} serves HTML, proxies /api, /terminal, and /events`);
      this.log("info", "[dev] press Ctrl-C to stop processes started by this supervisor");
      return this;
    } catch (error) {
      await this.stop("startup failure", 1);
      throw error;
    }
  }

  waitForExit() {
    return this.exitPromise;
  }

  async stop(reason = "shutdown", exitCode = 0) {
    if (this.state === "stopped") return this.stopPromise;
    if (this.state === "stopping") return this.stopPromise;

    this.state = "stopping";
    this.log("info", `[dev] stopping local stack (${reason})`);
    this.stopPromise = (async () => {
      const records = [...this.records.values()];
      const results = await Promise.allSettled(
        records.filter((record) => record.owned).map((record) => this.terminateRecord(record)),
      );
      let finalExitCode = exitCode;
      for (const result of results) {
        if (result.status !== "rejected") continue;
        const error = result.reason instanceof DevRuntimeError
          ? result.reason
          : new DevRuntimeError(errorMessage(result.reason), { cause: result.reason });
        this.failure ??= error;
        this.log("error", error.message);
      }
      if (this.failure && finalExitCode === 0) finalExitCode = 1;
      this.state = "stopped";
      this.resolveExit?.({ exitCode: finalExitCode, reason, failure: this.failure });
    })();
    return this.stopPromise;
  }

  async ensureService(name) {
    if (this.state !== "starting") return undefined;
    const definition = this.services[name];
    const inspection = await this.inspectPort(definition.host, definition.port);
    if (inspection.available) {
      this.log("info", `[dev] ${name} port ${definition.host}:${definition.port} is free; starting ${name}`);
      const record = this.launch(definition);
      this.records.set(name, record);
      await this.waitForReady(record);
      return record;
    }

    this.log("warn", `[dev] ${portDescription(definition, inspection)}; checking whether it is a healthy ${name}`);
    const record = this.createAdoptedRecord(definition, inspection);
    this.records.set(name, record);
    try {
      await this.waitForReady(record);
    } catch (error) {
      throw this.withPortRecovery(definition, error, inspection);
    }
    this.log("info", `[dev] reusing healthy ${name} on ${definition.host}:${definition.port} (${formatPortOwners(record.ownerSnapshot)})`);
    return record;
  }

  createAdoptedRecord(definition, inspection) {
    return {
      name: definition.name,
      definition,
      child: undefined,
      owned: false,
      exited: false,
      intentionalStop: false,
      ownerSnapshot: inspection.owners?.length ? normalizeOwners(inspection.owners) : undefined,
      exitPromise: Promise.resolve(),
    };
  }

  launch(definition) {
    const child = this.spawnProcess(pnpmCommand(), definition.args, {
      cwd: this.config.repoRoot,
      env: definition.environment,
      shell: false,
      detached: process.platform !== "win32",
      stdio: "inherit",
    });
    const record = {
      name: definition.name,
      definition,
      child,
      owned: true,
      exited: false,
      intentionalStop: false,
      ownerSnapshot: undefined,
      startError: undefined,
      exitCode: undefined,
      exitSignal: undefined,
    };
    record.exitPromise = new Promise((resolveResult) => {
      record.resolveExit = resolveResult;
    });

    child.once("error", (error) => {
      record.startError = error;
      this.log("error", `[dev] ${definition.name} failed to start: ${errorMessage(error)}`);
    });
    child.once("exit", (code, signal) => {
      record.exited = true;
      record.exitCode = code;
      record.exitSignal = signal;
      record.resolveExit?.();
      if (this.state === "running" && !record.intentionalStop) {
        void this.handleUnexpectedExit(record, code, signal);
      }
    });
    return record;
  }

  async waitForReady(record) {
    const deadline = Date.now() + this.config.readyTimeoutMs;
    let lastHealth = failedHealth("no health response yet");
    let lastInspection = { available: false, owners: record.ownerSnapshot ?? [] };

    while (Date.now() <= deadline) {
      if (record.startError) {
        throw new DevRuntimeError(`${record.name} failed to start: ${errorMessage(record.startError)}`, {
          service: record.name,
          cause: record.startError,
        });
      }
      if (record.exited) {
        throw new DevRuntimeError(`${record.name} exited before becoming ready (exit ${record.exitCode ?? "unknown"}${record.exitSignal ? `, ${record.exitSignal}` : ""})`, {
          service: record.name,
        });
      }

      lastInspection = await this.inspectPort(record.definition.host, record.definition.port);
      if (lastInspection.available) {
        lastHealth = failedHealth(`${record.name} is not listening on ${record.definition.host}:${record.definition.port}`);
      } else {
        if (record.ownerSnapshot && !ownersEqual(record.ownerSnapshot, lastInspection.owners)) {
          throw this.replacedProcessError(record.definition, record.ownerSnapshot, lastInspection.owners);
        }
        lastHealth = await this.checkHealth(record.definition);
        if (lastHealth.ok) {
          if (lastInspection.owners?.length) record.ownerSnapshot = normalizeOwners(lastInspection.owners);
          return lastHealth;
        }
      }

      if (Date.now() >= deadline) break;
      await this.sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }

    throw this.readinessError(record.definition, lastHealth, lastInspection);
  }

  async checkHealth(definition) {
    if (definition.name === "agentd") return checkAgentdHealth(this.config, this.probeHttp);
    return checkWebHealth(this.config, { http: this.probeHttp, websocket: this.probeWebSocket });
  }

  async handleUnexpectedExit(record, code, signal) {
    if (this.state !== "running" || record.intentionalStop) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    this.failure = new DevRuntimeError(
      `[dev] ${record.name} stopped unexpectedly with ${reason}; automatic restart is disabled`,
      { service: record.name },
    );
    this.log("error", this.failure.message);
    await this.stop("runtime failure", 1);
  }

  async terminateRecord(record) {
    if (!record?.owned || record.intentionalStop) return;
    record.intentionalStop = true;
    try {
      this.signalProcess(record.child, "SIGTERM");
    } catch (error) {
      this.log("warn", `[dev] could not send SIGTERM to ${record.name}: ${errorMessage(error)}`);
    }
    await this.waitForRecordExit(record, this.config.shutdownTimeoutMs);
    let portStatus = { released: false, owners: [] };
    try {
      portStatus = await this.waitForPortToFree(record.definition);
    } catch (error) {
      this.log("warn", `[dev] could not verify that ${record.name} released its port: ${errorMessage(error)}`);
    }
    if (!record.exited || !portStatus.released) {
      try {
        this.signalProcess(record.child, "SIGKILL");
      } catch (error) {
        this.log("warn", `[dev] could not send SIGKILL to ${record.name}: ${errorMessage(error)}`);
      }
      await this.waitForRecordExit(record, this.config.shutdownTimeoutMs);
      if (!portStatus.released) {
        try {
          portStatus = await this.waitForPortToFree(record.definition);
        } catch (error) {
          this.log("warn", `[dev] could not verify that ${record.name} released its port after SIGKILL: ${errorMessage(error)}`);
        }
      }
    }
    const replacementListener = Boolean(!portStatus.released
      && record.ownerSnapshot?.length
      && portStatus.owners?.length
      && !ownersEqual(record.ownerSnapshot, portStatus.owners));
    if (!record.exited || (!portStatus.released && !replacementListener)) {
      const error = new DevRuntimeError(
        `[dev] ${record.name} may still be running (PID ${record.child?.pid ?? "unknown"}); inspect its port with ${recoveryHint(record.definition)}`,
        { service: record.name },
      );
      this.failure ??= error;
      this.log("error", error.message);
    }
  }

  async waitForRecordExit(record, timeoutMs) {
    if (record.exited || !record.child?.pid) return;
    await Promise.race([record.exitPromise, delay(timeoutMs)]);
  }

  async waitForPortToFree(definition) {
    const deadline = Date.now() + this.config.shutdownTimeoutMs;
    let lastInspection = { available: false, owners: [] };
    while (Date.now() <= deadline) {
      lastInspection = await this.inspectPort(definition.host, definition.port);
      if (lastInspection.available) return { released: true, owners: [] };
      if (Date.now() >= deadline) break;
      await this.sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    this.log(
      "warn",
      `[dev] ${definition.name} port ${definition.host}:${definition.port} is still occupied by ${formatPortOwners(lastInspection.owners)}`,
    );
    return { released: false, owners: lastInspection.owners ?? [] };
  }

  withPortRecovery(definition, error, inspection) {
    if (error instanceof DevRuntimeError && error.message.includes("lsof")) return error;
    const ownerText = inspection ? ` Current owner: ${formatPortOwners(inspection.owners)}.` : "";
    return new DevRuntimeError(
      `[dev] ${definition.name} is not ready: ${errorMessage(error)}${ownerText} Recovery: ${recoveryHint(definition)}.`,
      { service: definition.name, cause: error },
    );
  }

  replacedProcessError(definition, expectedOwners, actualOwners) {
    return new DevRuntimeError(
      `[dev] ${definition.name} on ${definition.host}:${definition.port} was replaced: expected ${formatPortOwners(expectedOwners)}, found ${formatPortOwners(actualOwners)}. I will not kill the replacement. Recovery: ${recoveryHint(definition)}.`,
      { service: definition.name },
    );
  }

  readinessError(definition, health, inspection) {
    return new DevRuntimeError(
      `[dev] ${definition.name} did not become healthy on ${definition.host}:${definition.port} within ${this.config.readyTimeoutMs}ms: ${health.detail}. ${portDescription(definition, inspection)}. Recovery: ${recoveryHint(definition)}.`,
      { service: definition.name, cause: health.cause },
    );
  }

  log(level, message) {
    logWith(this.logger, level, message);
  }
}

export async function main(options = {}) {
  let supervisor;
  try {
    supervisor = createDevSupervisor(options);
  } catch (error) {
    const message = error instanceof DevRuntimeError ? error.message : `[dev] ${errorMessage(error)}`;
    console.error(message);
    process.exitCode = 1;
    return { exitCode: 1, failure: error };
  }
  const onSignal = (signal) => {
    void supervisor.stop(signal, 0);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const result = await supervisor.run();
    process.exitCode = result.exitCode;
    return result;
  } catch (error) {
    const message = error instanceof DevRuntimeError ? error.message : `[dev] ${errorMessage(error)}`;
    console.error(message);
    await supervisor.stop("startup failure", 1);
    process.exitCode = 1;
    return { exitCode: 1, failure: error };
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  void main().catch((error) => {
    console.error(`[dev] ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
