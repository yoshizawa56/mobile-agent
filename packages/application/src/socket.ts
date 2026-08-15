export const agentdSocketReadyState = {
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3,
} as const;

export type AgentdSocketData = string | Uint8Array;

/** Transport-neutral socket port used by terminal and event adapters. */
export interface AgentdSocket {
  readonly readyState: number;
  send(data: AgentdSocketData): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: AgentdSocketData, isBinary: boolean) => void): () => void;
  onClose(listener: () => void): () => void;
  onError(listener: (error: Error) => void): () => void;
}
