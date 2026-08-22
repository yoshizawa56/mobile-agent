import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { fetchTerminals } from "../../app/api/muximod-api";
import { useMuximodEvents } from "../../app/api/muximod-events";
import { useMuximodConnection } from "../../app/api/use-muximod-connection";
import type { ConnectionFlowViewModel, TerminalEndpoint } from "./-connection-flow-viewmodel";

export type TerminalsViewModel = Pick<ConnectionFlowViewModel, "terminals" | "status" | "errorMessage" | "onSelectTerminal" | "onOpenSettings" | "onOpenWorkspaces">;

export function useTerminalsViewModel(): TerminalsViewModel {
  const navigate = useNavigate();
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
  const terminals = terminalsQuery.data ?? [];

  return {
    terminals,
    status: connection ? queryStatus(terminalsQuery.status) : undefined,
    errorMessage: connection ? errorMessage(terminalsQuery.error) : null,
    onSelectTerminal: (terminal: TerminalEndpoint) => {
      void navigate({ to: "/terminals/$terminalId/sessions", params: { terminalId: terminal.id } });
    },
    onOpenSettings: () => {
      void navigate({ to: "/settings" });
    },
    onOpenWorkspaces: () => {
      void navigate({ to: "/workspaces" });
    },
  };
}

function queryStatus(status: "pending" | "error" | "success"): "loading" | "error" | "ready" {
  return status === "pending" ? "loading" : status === "error" ? "error" : "ready";
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? String(error) : null;
}
