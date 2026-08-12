import { agentdEventSchema, type AgentdEvent } from "@mobile-agent/protocol";
import { WebSocket } from "ws";

/**
 * Publishes small, non-authoritative invalidation events to connected clients.
 *
 * Event consumers must refetch the corresponding HTTP resource. The hub does
 * not retain events, so reconnecting clients always start with a fresh API
 * read instead of trying to replay an event log.
 */
export class AgentdEventHub {
  private readonly clients = new Set<WebSocket>();

  public add(socket: WebSocket): void {
    this.clients.add(socket);
    const remove = () => this.clients.delete(socket);
    socket.once("close", remove);
    socket.once("error", remove);
  }

  public publish(event: AgentdEvent): void {
    const payload = JSON.stringify(agentdEventSchema.parse(event));
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        this.clients.delete(client);
        continue;
      }

      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  public close(): void {
    for (const client of this.clients) {
      try {
        client.close(1001, "agentd stopped");
      } catch {
        // The peer may already have closed while agentd is shutting down.
      }
    }
    this.clients.clear();
  }
}
