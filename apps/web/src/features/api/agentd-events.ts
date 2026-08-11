import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AgentdConnection } from "@mobile-agent/agentd-client";
import { agentdEventSchema, type AgentdEvent } from "@mobile-agent/protocol";
import { isMockMode } from "../../mock/mock-data";
import { openAgentdEvents } from "./agentd-api";

type QueryKey = readonly unknown[];

/**
 * Returns the HTTP resources invalidated by a session update event.
 * The event contains no resource data; HTTP remains the source of truth.
 */
export function invalidationQueryKeys(connectionKey: string, event: AgentdEvent): QueryKey[] {
  return [
    ["sessions", connectionKey],
    ["panes", connectionKey, event.sessionName],
  ];
}

export function invalidateAgentdEvent(queryClient: Pick<QueryClient, "invalidateQueries">, connectionKey: string, event: AgentdEvent): void {
  for (const queryKey of invalidationQueryKeys(connectionKey, event)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useAgentdEvents(connection: AgentdConnection, connectionKey: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isMockMode()) return;

    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let retry = 0;

    const invalidateAll = () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions", connectionKey] });
      void queryClient.invalidateQueries({ queryKey: ["panes", connectionKey] });
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      const delay = Math.min(1_000 * 2 ** retry, 30_000);
      retry = Math.min(retry + 1, 5);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      try {
        socket = openAgentdEvents(connection);
      } catch {
        scheduleReconnect();
        return;
      }

      const current = socket;
      current.addEventListener("open", () => {
        retry = 0;
        invalidateAll();
      });
      current.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = agentdEventSchema.safeParse(payload);
        if (parsed.success) invalidateAgentdEvent(queryClient, connectionKey, parsed.data);
      });
      current.addEventListener("close", () => {
        if (socket === current) socket = undefined;
        scheduleReconnect();
      });
      current.addEventListener("error", () => {
        current.close();
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      socket?.close();
      socket = undefined;
    };
  }, [connection, connectionKey, queryClient]);
}
