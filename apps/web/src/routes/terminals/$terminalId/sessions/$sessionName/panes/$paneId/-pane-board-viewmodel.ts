import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MuximodConnection } from "../../../../../../../app/api/muximod-client.js";
import type { PaneSummary as ProtocolPaneSummary } from "@muximo/contract";
import { fetchPanes } from "../../../../../../../app/api/muximod-api";
import { paneQueryKey } from "../../../../../../../app/api/muximod-query-keys";
import { isMockMode } from "../../../../../../../mock/mock-data";

export type PaneSummary = ProtocolPaneSummary;

export type PaneBoardViewModel = {
  isOpen: boolean;
  selectedTarget: string;
  panes: PaneSummary[];
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  select: (pane: PaneSummary) => void;
  refresh: () => void;
};

export function usePaneBoardViewModel({ onSelect, selectedTarget, sessionName, connection, alwaysOpen = false }: { onSelect: (target: string) => void; selectedTarget: string; sessionName?: string; connection?: MuximodConnection; alwaysOpen?: boolean }): PaneBoardViewModel {
  const [isOpen, setIsOpen] = useState(false);
  const query = useQuery({
    queryKey: paneQueryKey(connection, sessionName),
    queryFn: () => {
      if (!connection) throw new Error("Connection profile is not configured");
      return fetchPanes(sessionName, connection);
    },
    enabled: Boolean(connection) && (alwaysOpen || isOpen),
    staleTime: 1_000,
    // While the window map is open poll for live layout updates. In the control
    // room muximod pushes session_updated events over its best-effort event
    // fallback can be a long safety net; mock mode has no event socket and
    // keeps polling so state changes are still detected.
    refetchInterval: isOpen ? 3_000 : alwaysOpen ? (isMockMode() ? 3_000 : 10_000) : false,
  });

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);
  const select = useCallback(
    (pane: PaneSummary) => {
      onSelect(pane.tmuxPaneId);
      setIsOpen(false);
    },
    [onSelect],
  );
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    isOpen,
    selectedTarget,
    panes: query.data ?? [],
    status: query.isPending ? "loading" : query.isError ? "error" : "ready",
    errorMessage: query.error instanceof Error ? query.error.message : query.isError ? "Unable to load panes" : null,
    open,
    close,
    toggle,
    select,
    refresh,
  };
}
