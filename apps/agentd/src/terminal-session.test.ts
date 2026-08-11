import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { IPty } from "node-pty";
import { clientControlMessageSchema, serverControlMessageSchema, terminalProtocolVersion } from "@mobile-agent/protocol";
import {
  TerminalSession,
  TerminalSessionRegistry,
  type TerminalSessionOptions,
} from "./terminal-session.js";

describe("terminal session lifecycle", () => {
  it("parks one PTY and viewport lease across a network reconnect", async () => {
    const harness = createHarness();
    const firstSocket = new FakeSocket();
    new TerminalSession(firstSocket.asWebSocket(), harness.options);

    firstSocket.receive(attachFrame());
    await flush();

    const ready = firstSocket.controls().find((message) => message.type === "ready");
    expect(ready?.type).toBe("ready");
    if (!ready || ready.type !== "ready") throw new Error("expected ready frame");
    expect(ready.resumed).toBe(false);
    expect(harness.manager.prepare).toHaveBeenCalledTimes(1);
    expect(harness.spawn).toHaveBeenCalledTimes(1);

    firstSocket.networkClose();
    expect(harness.lease.release).not.toHaveBeenCalled();
    expect(harness.pty.killed).toBe(0);
    expect(harness.registry.size).toBe(1);

    const secondSocket = new FakeSocket();
    new TerminalSession(secondSocket.asWebSocket(), harness.options);
    secondSocket.receive(attachFrame({ sessionId: ready.sessionId, resumeToken: ready.resumeToken }));
    await flush();

    expect(harness.manager.prepare).toHaveBeenCalledTimes(1);
    expect(harness.spawn).toHaveBeenCalledTimes(1);
    expect(harness.lease.claimMobile).toHaveBeenCalledWith(80, 24);
    expect(secondSocket.controls()).toContainEqual(expect.objectContaining({ type: "ready", resumed: true }));

    harness.pty.emitOutput("resumed output");
    expect(secondSocket.binaryFrames()).toEqual(["resumed output"]);

    secondSocket.receive(Buffer.from("ls"), true);
    await flush();
    expect(harness.pty.writes).toEqual(["ls"]);
  });

  it("releases the runtime only for an explicit detach", async () => {
    const harness = createHarness();
    const socket = new FakeSocket();
    new TerminalSession(socket.asWebSocket(), harness.options);

    socket.receive(attachFrame());
    await flush();
    socket.receive(JSON.stringify({ type: "detach", version: terminalProtocolVersion }));
    await flush();

    expect(socket.controls()).toContainEqual(expect.objectContaining({ type: "closed", reason: "detached" }));
    expect(harness.lease.release).toHaveBeenCalledTimes(1);
    expect(harness.pty.killed).toBe(1);
    expect(harness.registry.size).toBe(0);
  });

  it("does not create a duplicate lease while the original session is parked", async () => {
    const harness = createHarness();
    const firstSocket = new FakeSocket();
    new TerminalSession(firstSocket.asWebSocket(), harness.options);
    firstSocket.receive(attachFrame());
    await flush();
    firstSocket.networkClose();

    const secondSocket = new FakeSocket();
    new TerminalSession(secondSocket.asWebSocket(), harness.options);
    secondSocket.receive(attachFrame());
    await flush();

    expect(harness.manager.prepare).toHaveBeenCalledTimes(2);
    expect(harness.spawn).toHaveBeenCalledTimes(1);
    expect(harness.lease.release).not.toHaveBeenCalled();
    expect(secondSocket.controls()).toContainEqual(expect.objectContaining({ type: "error", code: "attach_failed" }));
  });

  it("expires a parked runtime after the resume grace period", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({ resumeGraceMs: 100 });
      const socket = new FakeSocket();
      new TerminalSession(socket.asWebSocket(), harness.options);
      socket.receive(attachFrame());
      await flush();
      socket.networkClose();

      vi.advanceTimersByTime(100);
      expect(harness.lease.release).toHaveBeenCalledTimes(1);
      expect(harness.pty.killed).toBe(1);
      expect(harness.registry.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createHarness(overrides: Partial<TerminalSessionOptions> = {}) {
  const pty = new FakePty(401);
  const lease = {
    id: "lease-1",
    target: "%0",
    paneId: "%0",
    windowId: "@0",
    sessionName: "agentd",
    claimMobile: vi.fn(),
    resize: vi.fn(),
    release: vi.fn(),
  };
  const prepared = {
    target: "%0",
    pane: { paneId: "%0", windowId: "@0", sessionName: "agentd" },
    snapshot: {} as never,
    attach: vi.fn(async () => lease),
    release: vi.fn(),
  };
  let preparedCount = 0;
  const manager = {
    prepare: vi.fn(() => {
      preparedCount += 1;
      if (preparedCount > 1) throw new Error("Viewport is already in use for tmux window: @0");
      return prepared;
    }),
    tmux: { attachArgs: vi.fn(() => ["attach-session", "-t", "agentd"]) },
  };
  const spawn = vi.fn(() => pty.asIPty());
  const registry = new TerminalSessionRegistry();
  const options: TerminalSessionOptions = {
    cwd: "/tmp",
    defaultTarget: "agentd",
    viewportManager: manager as unknown as TerminalSessionOptions["viewportManager"],
    spawnPty: spawn as unknown as TerminalSessionOptions["spawnPty"],
    sessions: registry,
    ...overrides,
  };
  return { manager, prepared, lease, pty, spawn, registry, options };
}

function attachFrame(credentials: { sessionId?: string; resumeToken?: string } = {}): string {
  const result = clientControlMessageSchema.parse({
    type: "attach",
    version: terminalProtocolVersion,
    target: "%0",
    cols: 80,
    rows: 24,
    ...credentials,
  });
  return JSON.stringify(result);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeSocket extends EventEmitter {
  public readyState: number = WebSocket.OPEN;
  public readonly sent: Array<string | Buffer> = [];

  public send(data: string | Buffer): void {
    if (this.readyState !== WebSocket.OPEN) throw new Error("socket is closed");
    this.sent.push(data);
  }

  public receive(data: string | Buffer, isBinary = false): void {
    this.emit("message", data, isBinary);
  }

  public networkClose(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1006, Buffer.from("network-lost"));
  }

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1000, Buffer.from("closed"));
  }

  public controls() {
    return this.sent
      .filter((frame): frame is string => typeof frame === "string")
      .map((frame) => serverControlMessageSchema.parse(JSON.parse(frame)));
  }

  public binaryFrames(): string[] {
    return this.sent
      .filter((frame): frame is Buffer => Buffer.isBuffer(frame))
      .map((frame) => frame.toString("utf8"));
  }

  public asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

class FakePty {
  public readonly writes: string[] = [];
  public readonly resizeCalls: Array<[number, number]> = [];
  public killed = 0;
  private dataHandler: ((data: string) => void) | undefined;

  public constructor(public readonly pid: number) {}

  public onData(handler: (data: string) => void): { dispose: () => void } {
    this.dataHandler = handler;
    return { dispose: () => { this.dataHandler = undefined; } };
  }

  public onExit(_handler: (event: { exitCode: number; signal?: number }) => void): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  public write(data: string): void {
    this.writes.push(data);
  }

  public resize(cols: number, rows: number): void {
    this.resizeCalls.push([cols, rows]);
  }

  public kill(): void {
    this.killed += 1;
  }

  public emitOutput(data: string): void {
    this.dataHandler?.(data);
  }

  public asIPty(): IPty {
    return this as unknown as IPty;
  }
}
