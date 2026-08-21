import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { fetchPanes } from "../../../../../../../app/api/muximod-api";
import { paneQueryKey } from "../../../../../../../app/api/muximod-query-keys";
import type { PaneBoardViewModel } from "./-pane-board-viewmodel";
import { usePaneBoardViewModel } from "./-pane-board-viewmodel";
import type { PaneViewModel } from "./-terminal-viewmodel";
import { usePaneViewModel } from "./-terminal-viewmodel";
import { useTerminalResources } from "../../../../../-terminal-resources";

export type ControlRoomViewModel = {
  terminal: PaneViewModel;
  paneBoard: PaneBoardViewModel;
  onSessionSelect: () => void;
  onNewPane: () => void;
};

export function useControlRoomViewModel(): ControlRoomViewModel {
  const navigate = useNavigate();
  const { terminalId, sessionName, paneId } = useParams({ from: "/terminals/$terminalId/sessions/$sessionName/panes/$paneId/" });
  const resources = useTerminalResources({ terminalId, sessionName });
  const connection = resources.connection;
  const panesQuery = useQuery({
    queryKey: paneQueryKey(connection, resources.selectedSession?.name ?? sessionName),
    queryFn: () => {
      if (!connection) throw new Error("Connection profile is not configured");
      return fetchPanes(resources.selectedSession?.name ?? sessionName, connection);
    },
    enabled: Boolean(connection) && Boolean(sessionName),
    staleTime: 1_000,
    retry: 1,
  });
  const panes = panesQuery.data ?? [];
  const selectedPane = panes.find((pane) => pane.id === paneId) ?? null;
  const selectedTarget = selectedPane?.tmuxPaneId ?? "";
  const terminal = usePaneViewModel({ target: selectedTarget, connection });
  const paneBoard = usePaneBoardViewModel({
    selectedTarget,
    sessionName,
    connection,
    alwaysOpen: true,
    onSelect: (target) => {
      const pane = panes.find((candidate) => candidate.tmuxPaneId === target);
      if (pane) void navigate({ to: "/terminals/$terminalId/sessions/$sessionName/panes/$paneId", params: { terminalId, sessionName, paneId: pane.id } });
    },
  });

  return {
    terminal,
    paneBoard,
    onSessionSelect: () => {
      void navigate({ to: "/terminals/$terminalId/sessions", params: { terminalId } });
    },
    onNewPane: () => {
      void navigate({ to: "/terminals/$terminalId/sessions/$sessionName/panes/new", params: { terminalId, sessionName } });
    },
  };
}
