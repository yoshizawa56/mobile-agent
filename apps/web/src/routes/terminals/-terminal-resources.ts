import { useQuery } from "@tanstack/react-query";
import type { TmuxSession } from "@muximo/contract";
import { fetchSessions, fetchTerminals } from "../../app/api/muximod-api";
import { useMuximodEvents } from "../../app/api/muximod-events";
import { useMuximodConnection } from "../../app/api/use-muximod-connection";
import type { ConnectionFlowViewModel, TerminalEndpoint } from "./-connection-flow-viewmodel";

export type TerminalResources = {
  connection: ReturnType<typeof useMuximodConnection>["connection"];
  connectionKey: string;
  terminals: TerminalEndpoint[];
  sessions: TmuxSession[];
  selectedTerminal: TerminalEndpoint | null;
  selectedSession: TmuxSession | null;
  terminalsStatus: ConnectionFlowViewModel["status"];
  terminalsError: string | null;
  sessionsStatus: ConnectionFlowViewModel["status"];
  sessionsError: string | null;
};

export function useTerminalResources({ terminalId, sessionName, pollSessions = false }: { terminalId?: string; sessionName?: string; pollSessions?: boolean }): TerminalResources {
  const { connection, connectionKey } = useMuximodConnection();
  useMuximodEvents(connection, connectionKey);

  const terminalsQuery = useQuery({
    queryKey: ["terminals", connectionKey],
    queryFn: () => {
      if (!connection) throw new Error("Connection profile is not configured");
      return fetchTerminals(connection);
    },
    enabled: Boolean(connection),
    staleTime: 5_000,
    retry: 1,
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions", connectionKey, terminalId],
    queryFn: () => {
      if (!connection) throw new Error("Connection profile is not configured");
      return fetchSessions(connection);
    },
    enabled: Boolean(connection) && Boolean(terminalId),
    staleTime: 1_000,
    refetchInterval: pollSessions ? 5_000 : false,
    retry: 1,
  });

  const terminals = terminalsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];

  return {
    connection,
    connectionKey,
    terminals,
    sessions,
    selectedTerminal: terminals.find((terminal) => terminal.id === terminalId) ?? null,
    selectedSession: sessions.find((session) => session.name === sessionName) ?? null,
    terminalsStatus: queryStatus(terminalsQuery.status),
    terminalsError: errorMessage(terminalsQuery.error),
    sessionsStatus: queryStatus(sessionsQuery.status),
    sessionsError: errorMessage(sessionsQuery.error),
  };
}

export const fallbackTerminal: TerminalEndpoint = {
  id: "local",
  name: "local terminal",
  host: "localhost",
  tailnetIp: "localhost",
  state: "online",
  detail: "muximod",
  lastSeen: "unknown",
};

export const fallbackSession: TmuxSession = {
  name: "session",
  paneCount: 0,
  waitingCount: 0,
  detail: "tmux",
};

export function queryStatus(status: "pending" | "error" | "success"): "loading" | "error" | "ready" {
  return status === "pending" ? "loading" : status === "error" ? "error" : "ready";
}

export function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? String(error) : null;
}
