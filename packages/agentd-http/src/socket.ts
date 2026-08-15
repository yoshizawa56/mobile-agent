import type { AgentdSocket, AgentdSocketData } from "@mobile-agent/application";

export { agentdSocketReadyState } from "@mobile-agent/application";
export type { AgentdSocket, AgentdSocketData } from "@mobile-agent/application";

type HonoSocketContext = {
  readonly readyState: number;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
};

/** Adapts Hono's Bun `WSContext` to the transport-neutral contract. */
export class HonoSocketAdapter implements AgentdSocket {
  private readonly messageListeners = new Set<(data: AgentdSocketData, isBinary: boolean) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  public constructor(private readonly context: HonoSocketContext) {}

  public get readyState(): number {
    return this.context.readyState;
  }

  public send(data: AgentdSocketData): void {
    this.context.send(data);
  }

  public close(code?: number, reason?: string): void {
    this.context.close(code, reason);
  }

  public onMessage(listener: (data: AgentdSocketData, isBinary: boolean) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  public onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  public receive(data: unknown): void {
    if (typeof data === "string") {
      this.notifyMessage(data, false);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.notifyMessage(new Uint8Array(data), true);
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.notifyMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), true);
      return;
    }
    this.notifyError(new Error("unsupported WebSocket message type"));
  }

  public receiveClose(): void {
    for (const listener of [...this.closeListeners]) listener();
  }

  public receiveError(error: unknown): void {
    this.notifyError(error instanceof Error ? error : new Error(String(error)));
  }

  private notifyMessage(data: AgentdSocketData, isBinary: boolean): void {
    for (const listener of [...this.messageListeners]) listener(data, isBinary);
  }

  private notifyError(error: Error): void {
    for (const listener of [...this.errorListeners]) listener(error);
  }
}
