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
  toggle: () => void;
  select: (pane: PaneSummary) => void;
  refresh: () => void;
};

export function paneQueryKey(connection?: AgentdConnection, sessionName?: string): readonly [string, string, string] {
  return ["panes", connection?.httpBaseUrl ?? "default", sessionName ?? "all"];
}

export function usePaneBoardViewModel({ onSelect, selectedTarget, sessionName, connection, alwaysOpen = false }: { onSelect: (target: string) => void; selectedTarget: string; sessionName?: string; connection?: AgentdConnection; alwaysOpen?: boolean }): PaneBoardViewModel {
  const [isOpen, setIsOpen] = useState(false);
  const query = useQuery({
    queryKey: paneQueryKey(connection, sessionName),
    queryFn: () => fetchPanes(sessionName, connection),
    enabled: alwaysOpen || isOpen,
    staleTime: 1_000,
    refetchInterval: isOpen ? 3_000 : false,
  });

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
    errorMessage: query.error instanceof Error ? query.error.message : query.isError ? "ペイン一覧を取得できません" : null,
    toggle,
    select,
    refresh,
  };
}

export function paneStateLabel(state: PaneSummary["state"]): string {
  switch (state) {
    case "waiting_input":
      return "入力待ち";
    case "waiting_approval":
      return "承認待ち";
    case "failed":
      return "失敗";
    case "completed":
      return "完了";
    case "stopped":
      return "停止";
    case "starting":
      return "起動中";
    default:
      return "実行中";
  }
}
