import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentdConnection } from "@mobile-agent/agentd-client";
import type { PaneSummary as ProtocolPaneSummary } from "@mobile-agent/protocol";
import { fetchPanes } from "../api/agentd-api";

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

export function paneQueryKey(connection?: AgentdConnection, sessionName?: string): readonly [string, string, string] {
  return ["panes", connection?.httpBaseUrl ?? "unconfigured", sessionName ?? "all"];
}

export function usePaneBoardViewModel({ onSelect, selectedTarget, sessionName, connection, alwaysOpen = false }: { onSelect: (target: string) => void; selectedTarget: string; sessionName?: string; connection?: AgentdConnection; alwaysOpen?: boolean }): PaneBoardViewModel {
  const [isOpen, setIsOpen] = useState(false);
  const query = useQuery({
    queryKey: paneQueryKey(connection, sessionName),
    queryFn: () => {
      if (!connection) throw new Error("Connection profile is not configured");
      return fetchPanes(sessionName, connection);
    },
    enabled: Boolean(connection) && (alwaysOpen || isOpen),
    staleTime: 1_000,
    refetchInterval: isOpen ? 3_000 : false,
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

export function paneStateLabel(state: PaneSummary["state"]): string {
  switch (state) {
    case "waiting_input":
      return "Waiting for input";
    case "waiting_approval":
      return "Waiting for approval";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "starting":
      return "Starting";
    default:
      return "Running";
  }
}
