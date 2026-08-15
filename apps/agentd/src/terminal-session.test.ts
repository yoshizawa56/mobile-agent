import { EventEmitter } from "node:events";
import { describe, it, vi } from "vitest";
import { agentdSocketReadyState } from "@mobile-agent/application";
import { clientControlMessageSchema, serverControlMessageSchema, terminalProtocolVersion } from "@mobile-agent/protocol";
import {
  hasObserved,
  runScenarioTable,
  type FixtureHandle,
  type ScenarioCase,
  type ScenarioTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import type { PtyProcess } from "./pty.js";
import { TerminalSession, TerminalSessionRegistry, type TerminalSessionOptions } from "./terminal-session.js";

type SessionStep =
  | { type: "connect"; socket: "first" | "second"; credentials?: "resume-first" }
  | { type: "network-close"; socket: "first" | "second" }
  | { type: "detach"; socket: "first" | "second" }
  | { type: "emit-output"; value: string }
  | { type: "send-input"; value: string }
  | { type: "advance"; milliseconds: number };
type SessionContext = {
  prepareCalls: number;
  spawnCalls: number;
  releaseCalls: number;
  killed: number;
  registrySize: number;
  secondResumed: boolean;
  secondErrors: readonly string[];
  firstClosedReasons: readonly string[];
  binaryFrames: readonly string[];
  writes: readonly string[];
};
type SessionFixture = ReturnType<typeof createHarness> & { sockets: Partial<Record<"first" | "second", FakeSocket>> };

const sessionFixture = (): FixtureHandle<SessionFixture> => {
  vi.useFakeTimers();
  const harness = createHarness({ resumeGraceMs: 100 });
  return {
    fixture: { ...harness, sockets: {} },
    cleanup: () => { vi.useRealTimers(); vi.restoreAllMocks(); },
  };
};

const cases = [
  {
    name: "parks one PTY and viewport lease across a network reconnect",
    steps: [
      { type: "connect", socket: "first" },
      { type: "network-close", socket: "first" },
      { type: "connect", socket: "second", credentials: "resume-first" },
      { type: "emit-output", value: "resumed output" },
      { type: "send-input", value: "ls" },
    ],
    assert: [
      hasObserved<SessionContext, undefined>("prepareCalls", 1),
      hasObserved<SessionContext, undefined>("spawnCalls", 1),
      hasObserved<SessionContext, undefined>("releaseCalls", 0),
      hasObserved<SessionContext, undefined>("killed", 0),
      hasObserved<SessionContext, undefined>("registrySize", 1),
      hasObserved<SessionContext, undefined>("secondResumed", true),
      hasObserved<SessionContext, undefined>("binaryFrames", ["resumed output"]),
      hasObserved<SessionContext, undefined>("writes", ["ls"]),
    ],
  },
  {
    name: "releases the runtime only for an explicit detach",
    steps: [{ type: "connect", socket: "first" }, { type: "detach", socket: "first" }],
    assert: [hasObserved<SessionContext, undefined>("firstClosedReasons", ["detached"]), hasObserved<SessionContext, undefined>("releaseCalls", 1), hasObserved<SessionContext, undefined>("killed", 1), hasObserved<SessionContext, undefined>("registrySize", 0)],
  },
  {
    name: "does not create a duplicate lease while the original session is parked",
    steps: [{ type: "connect", socket: "first" }, { type: "network-close", socket: "first" }, { type: "connect", socket: "second" }],
    assert: [hasObserved<SessionContext, undefined>("prepareCalls", 2), hasObserved<SessionContext, undefined>("spawnCalls", 1), hasObserved<SessionContext, undefined>("releaseCalls", 0), hasObserved<SessionContext, undefined>("secondErrors", ["attach_failed"])],
  },
  {
    name: "expires a parked runtime after the resume grace period",
    steps: [{ type: "connect", socket: "first" }, { type: "network-close", socket: "first" }, { type: "advance", milliseconds: 100 }],
    assert: [hasObserved<SessionContext, undefined>("releaseCalls", 1), hasObserved<SessionContext, undefined>("killed", 1), hasObserved<SessionContext, undefined>("registrySize", 0)],
  },
] satisfies readonly ScenarioCase<"default", SessionStep, undefined, SessionContext>[];

const table: ScenarioTable<SessionFixture, "default", SessionStep, undefined, SessionContext> = {
  defaultFixture: sessionFixture,
  cases,
  execute: async (fixture, steps) => {
    for (const step of steps) {
      if (step.type === "connect") {
        const socket = new FakeSocket();
        fixture.sockets[step.socket] = socket;
        new TerminalSession(socket, fixture.options);
        const previousReady = fixture.sockets.first?.controls().find((message) => message.type === "ready");
        const credentials = step.credentials === "resume-first" && previousReady?.type === "ready"
          ? { sessionId: previousReady.sessionId, resumeToken: previousReady.resumeToken }
          : {};
        socket.receive(attachFrame(credentials));
        await flush();
      }
      if (step.type === "network-close") fixture.sockets[step.socket]?.networkClose();
      if (step.type === "detach") {
        fixture.sockets[step.socket]?.receive(JSON.stringify({ type: "detach", version: terminalProtocolVersion }));
        await flush();
      }
      if (step.type === "emit-output") fixture.pty.emitOutput(step.value);
      if (step.type === "send-input") {
        fixture.sockets.second?.receive(Buffer.from(step.value), true);
        await flush();
      }
      if (step.type === "advance") vi.advanceTimersByTime(step.milliseconds);
    }
  },
  observe: (fixture) => ({
    prepareCalls: fixture.manager.prepare.mock.calls.length,
    spawnCalls: fixture.spawn.mock.calls.length,
    releaseCalls: fixture.lease.release.mock.calls.length,
    killed: fixture.pty.killed,
    registrySize: fixture.registry.size,
    secondResumed: fixture.sockets.second?.controls().some((message) => message.type === "ready" && message.resumed) ?? false,
    secondErrors: fixture.sockets.second?.controls().filter((message) => message.type === "error").map((message) => message.code) ?? [],
    firstClosedReasons: fixture.sockets.first?.controls().filter((message) => message.type === "closed").map((message) => message.reason) ?? [],
    binaryFrames: fixture.sockets.second?.binaryFrames() ?? [],
    writes: [...fixture.pty.writes],
  }),
};

describe("terminal session lifecycle", () => {
  runScenarioTable(it as unknown as TestRegistrar, table);
});

function createHarness(overrides: Partial<TerminalSessionOptions> = {}) {
  const pty = new FakePty(401);
  const lease = { id: "lease-1", target: "%0", paneId: "%0", windowId: "@0", sessionName: "agentd", claimMobile: vi.fn(), resize: vi.fn(), release: vi.fn() };
  const prepared = { target: "%0", pane: { paneId: "%0", windowId: "@0", sessionName: "agentd" }, snapshot: {} as never, attach: vi.fn(async () => lease), release: vi.fn() };
  let preparedCount = 0;
  const manager = { prepare: vi.fn(() => { preparedCount += 1; if (preparedCount > 1) throw new Error("Viewport is already in use for tmux window: @0"); return prepared; }), tmux: { attachArgs: vi.fn(() => ["attach-session", "-t", "agentd"]) } };
  const spawn = vi.fn(() => pty.asPty());
  const registry = new TerminalSessionRegistry();
  const options: TerminalSessionOptions = { cwd: "/tmp", defaultTarget: "agentd", viewportManager: manager as unknown as TerminalSessionOptions["viewportManager"], spawnPty: spawn as unknown as TerminalSessionOptions["spawnPty"], sessions: registry, ...overrides };
  return { manager, prepared, lease, pty, spawn, registry, options };
}

function attachFrame(credentials: { sessionId?: string; resumeToken?: string } = {}): string {
  return JSON.stringify(clientControlMessageSchema.parse({ type: "attach", version: terminalProtocolVersion, target: "%0", cols: 80, rows: 24, ...credentials }));
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

class FakeSocket extends EventEmitter {
  public readyState: number = agentdSocketReadyState.open;
  public readonly sent: Array<string | Uint8Array> = [];
  public send(data: string | Uint8Array): void { if (this.readyState !== agentdSocketReadyState.open) throw new Error("socket is closed"); this.sent.push(data); }
  public receive(data: string | Uint8Array, isBinary = false): void { this.emit("message", data, isBinary); }
  public networkClose(): void { this.readyState = agentdSocketReadyState.closed; this.emit("close"); }
  public close(): void { this.readyState = agentdSocketReadyState.closed; this.emit("close"); }
  public onMessage(listener: (data: string | Uint8Array, isBinary: boolean) => void): () => void { this.on("message", listener); return () => this.removeListener("message", listener); }
  public onClose(listener: () => void): () => void { this.on("close", listener); return () => this.removeListener("close", listener); }
  public onError(listener: (error: Error) => void): () => void { this.on("error", listener); return () => this.removeListener("error", listener); }
  public controls() { return this.sent.filter((frame): frame is string => typeof frame === "string").map((frame) => serverControlMessageSchema.parse(JSON.parse(frame))); }
  public binaryFrames(): string[] { return this.sent.filter((frame): frame is Uint8Array => typeof frame !== "string").map((frame) => Buffer.from(frame).toString("utf8")); }
}

class FakePty {
  public readonly writes: string[] = [];
  public readonly resizeCalls: Array<[number, number]> = [];
  public killed = 0;
  private dataHandler: ((data: string) => void) | undefined;
  public constructor(public readonly pid: number) {}
  public onData(handler: (data: string) => void): { dispose: () => void } { this.dataHandler = handler; return { dispose: () => { this.dataHandler = undefined; } }; }
  public onExit(_handler: (event: { exitCode: number; signal?: number }) => void): { dispose: () => void } { return { dispose: () => undefined }; }
  public write(data: string): void { this.writes.push(data); }
  public resize(cols: number, rows: number): void { this.resizeCalls.push([cols, rows]); }
  public kill(): void { this.killed += 1; }
  public emitOutput(data: string): void { this.dataHandler?.(data); }
  public asPty(): PtyProcess { return this as unknown as PtyProcess; }
}
