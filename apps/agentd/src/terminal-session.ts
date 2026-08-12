import type { RawData } from "ws";
import { WebSocket } from "ws";
import { spawnPty, type PtyProcess } from "./pty.js";
import {
  clientControlMessageSchema,
  type ClientControlMessage,
  type ServerControlMessage,
} from "@mobile-agent/protocol";
import { TmuxViewportManager, type ViewportLease } from "./viewport-manager.js";

type TerminalSessionOptions = {
  cwd: string;
  defaultTarget: string;
  viewportManager: TmuxViewportManager;
};

export class TerminalSession {
  private pty: PtyProcess | undefined;
  private lease: ViewportLease | undefined;
  private disposed = false;
  private attachGeneration = 0;

  public constructor(
    private readonly socket: WebSocket,
    private readonly options: TerminalSessionOptions,
  ) {
    socket.on("message", (data, isBinary) => {
      void this.handleMessage(data, isBinary);
    });
    socket.on("close", () => this.dispose());
    socket.on("error", () => this.dispose());
  }

  private async handleMessage(data: RawData, isBinary: boolean) {
    if (this.disposed) return;

    if (isBinary) {
      try {
        this.lease?.claimMobile();
        this.pty?.write(rawDataToBuffer(data).toString("utf8"));
      } catch (error) {
        this.sendError("mobile_claim_failed", error);
      }
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(rawDataToBuffer(data).toString("utf8"));
    } catch {
      this.send({ type: "error", code: "invalid_json", message: "Invalid JSON control frame" });
      return;
    }

    const parsed = clientControlMessageSchema.safeParse(input);
    if (!parsed.success) {
      this.send({ type: "error", code: "invalid_message", message: parsed.error.message });
      return;
    }

    await this.handleControlMessage(parsed.data);
  }

  private async handleControlMessage(message: ClientControlMessage) {
    switch (message.type) {
      case "attach":
        await this.attach(message.target || this.options.defaultTarget, message.cols, message.rows);
        return;
      case "claim":
        try {
          this.lease?.claimMobile();
        } catch (error) {
          this.sendError("mobile_claim_failed", error);
        }
        return;
      case "resize":
        try {
          this.lease?.claimMobile(message.cols, message.rows);
          this.pty?.resize(message.cols, message.rows);
        } catch (error) {
          this.sendError("resize_failed", error);
        }
        return;
      case "detach":
        this.dispose();
        this.socket.close(1000, "detached");
        return;
    }
  }

  private async attach(target: string, cols: number, rows: number) {
    const generation = ++this.attachGeneration;
    this.stopPty();

    let prepared: ReturnType<TmuxViewportManager["prepare"]> | undefined;
    let pty: PtyProcess | undefined;
    try {
      prepared = this.options.viewportManager.prepare(target, this.options.cwd, cols, rows);
      pty = spawnPty(
        "tmux",
        this.options.viewportManager.tmux.attachArgs(prepared.pane.paneId),
        {
          name: "xterm-256color",
          cols,
          rows,
          cwd: this.options.cwd,
          env: {
            ...stringEnvironment(process.env),
            TERM: "xterm-256color",
          },
        },
      );

      this.pty = pty;
      pty.onData((output) => this.sendBinary(Buffer.from(output, "utf8")));
      pty.onExit(({ exitCode, signal }) => {
        if (this.pty !== pty) return;
        this.pty = undefined;
        this.lease?.release();
        this.lease = undefined;
        if (!this.disposed) {
          this.send({
            type: "closed",
            code: exitCode,
            signal: signal ? String(signal) : null,
          });
        }
      });

      const lease = await prepared.attach({
        ptyPid: pty.pid,
        cols,
        rows,
        onEvent: (event) => this.send({ type: "viewport", ...event }),
      });

      if (generation !== this.attachGeneration || this.disposed) {
        lease.release();
        return;
      }

      this.lease = lease;
      this.send({
        type: "ready",
        target,
        paneId: lease.paneId,
        windowId: lease.windowId,
        cols,
        rows,
      });
    } catch (error) {
      if (this.pty === pty) this.pty = undefined;
      if (pty) pty.kill();
      this.lease?.release();
      this.lease = undefined;
      prepared?.release();
      this.sendError("attach_failed", error);
    }
  }

  private stopPty() {
    const pty = this.pty;
    this.pty = undefined;
    if (pty) pty.kill();

    const lease = this.lease;
    this.lease = undefined;
    lease?.release();
  }

  private send(message: ServerControlMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private sendBinary(data: Buffer) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(data);
  }

  private sendError(code: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.send({ type: "error", code, message });
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPty();
  }
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}
