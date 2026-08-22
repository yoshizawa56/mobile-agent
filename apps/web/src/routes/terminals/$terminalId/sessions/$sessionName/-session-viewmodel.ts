import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { PaneSummary } from "@muximo/contract";
import { fetchPanes } from "../../../../../app/api/muximod-api";
import { paneQueryKey } from "../../../../../app/api/muximod-query-keys";
import type { TerminalEndpoint, TmuxSession } from "../../../-connection-flow-viewmodel";
import { fallbackSession, fallbackTerminal, useTerminalResources } from "../../../-terminal-resources";

export type SessionOverviewViewModel = {
  terminal: TerminalEndpoint;
  session: TmuxSession;
  panes: PaneSummary[];
  status?: "loading" | "ready" | "error";
  errorMessage?: string | null;
  onSelectPane: (pane: PaneSummary) => void;
  onCreatePane: () => void;
  onBack: () => void;
  onDisconnect: () => void;
};

export function useSessionViewModel(): SessionOverviewViewModel {
  const navigate = useNavigate();
  const { terminalId, sessionName } = useParams({ from: "/terminals/$terminalId/sessions/$sessionName/" });
  const resources = useTerminalResources({ terminalId, sessionName });
  const panesQuery = useQuery({
    queryKey: paneQueryKey(resources.connection, resources.selectedSession?.name ?? sessionName),
    queryFn: () => {
      if (!resources.connection) throw new Error("Connection profile is not configured");
      return fetchPanes(resources.selectedSession?.name ?? sessionName, resources.connection);
    },
    enabled: Boolean(resources.connection) && Boolean(sessionName),
    staleTime: 1_000,
    refetchInterval: 3_000,
    retry: 1,
  });

  return {
    terminal: resources.selectedTerminal ?? fallbackTerminal,
    session: resources.selectedSession ?? fallbackSession,
    panes: panesQuery.data ?? [],
    status: panesQuery.isPending ? "loading" : panesQuery.isError ? "error" : "ready",
    errorMessage: panesQuery.error instanceof Error ? panesQuery.error.message : panesQuery.isError ? "Unable to load panes" : null,
    onSelectPane: (pane) => {
      void navigate({ to: "/terminals/$terminalId/sessions/$sessionName/panes/$paneId", params: { terminalId, sessionName, paneId: pane.id } });
    },
    onCreatePane: () => {
      void navigate({ to: "/terminals/$terminalId/sessions/$sessionName/panes/new", params: { terminalId, sessionName } });
    },
    onBack: () => {
      void navigate({ to: "/terminals/$terminalId/sessions", params: { terminalId } });
    },
    onDisconnect: () => {
      void navigate({ to: "/terminals/$terminalId/sessions/$sessionName/disconnected", params: { terminalId, sessionName } });
    },
  };
}
