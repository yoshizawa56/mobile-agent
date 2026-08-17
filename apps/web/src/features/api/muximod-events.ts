import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { MuximodConnection } from "@muximo/muximod-client";
import { muximodEventSchema, type MuximodEvent } from "@muximo/protocol";
import { isMockMode } from "../../mock/mock-data";
import { openMuximodEvents } from "./muximod-api";
import { paneQueryKey } from "../pane-board/pane-board-viewmodel";

type QueryKey = readonly unknown[];

/**
 * Returns the HTTP resources invalidated by a session update event.
 * The event contains no resource data; HTTP remains the source of truth.
 * Pane queries are keyed by the connection's HTTP base URL (see paneQueryKey),
 * so the connection is required to build the matching invalidation key.
 */
export function invalidationQueryKeys(connectionKey: string, connection: MuximodConnection | undefined, event: MuximodEvent): QueryKey[] {
  return [
    ["sessions", connectionKey],
    paneQueryKey(connection, event.sessionName),
  ];
}

export function invalidateMuximodEvent(queryClient: Pick<QueryClient, "invalidateQueries">, connectionKey: string, connection: MuximodConnection | undefined, event: MuximodEvent): void {
  for (const queryKey of invalidationQueryKeys(connectionKey, connection, event)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useMuximodEvents(connection: MuximodConnection | undefined, connectionKey: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isMockMode() || !connection?.auth) return;

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

    const connect = async () => {
      if (disposed) return;
      try {
        socket = await openMuximodEvents(connection);
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed) {
        socket.close();
        socket = undefined;
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
        const parsed = muximodEventSchema.safeParse(payload);
        if (parsed.success) invalidateMuximodEvent(queryClient, connectionKey, connection, parsed.data);
      });
      current.addEventListener("close", () => {
        if (socket === current) socket = undefined;
        scheduleReconnect();
      });
      current.addEventListener("error", () => {
        current.close();
      });
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      socket?.close();
      socket = undefined;
    };
  }, [connection, connectionKey, queryClient]);
}
