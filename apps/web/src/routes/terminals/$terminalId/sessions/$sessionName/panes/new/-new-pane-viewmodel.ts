import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { PanePlacement, PaneSummary } from "@muximo/api";
import { createPane, fetchPanes } from "../../../../../../../app/api/muximod-api";
import { paneQueryKey } from "../../../../../../../app/api/muximod-query-keys";
import { useMuximodConnection } from "../../../../../../../app/api/use-muximod-connection";
import type { TerminalEndpoint, TmuxSession } from "../../../../../-connection-flow-viewmodel";
import { fallbackSession, fallbackTerminal, useTerminalResources } from "../../../../../-terminal-resources";
import { useWorkspacePickerViewModel, workspacePickerState, type WorkspacePickerViewModel } from "../../../-workspace-picker-viewmodel";

export type NewPaneKind = "agent" | "shell";
export type NewPaneAgent = "codex" | "claude" | "opencode";

export type NewPaneViewModel = {
  terminal: TerminalEndpoint;
  session: TmuxSession;
  name: string;
  workspacePicker: WorkspacePickerViewModel;
  kind: NewPaneKind;
  agentId: NewPaneAgent;
  existingPanes: PaneSummary[];
  placement: PanePlacement;
  targetPaneId: string | null;
  isCreating: boolean;
  errorMessage: string | null;
  onNameChange: (value: string) => void;
  onKindChange: (value: NewPaneKind) => void;
  onAgentChange: (value: NewPaneAgent) => void;
  onPlacementChange: (value: PanePlacement) => void;
  onTargetPaneChange: (value: string) => void;
  onCreate: () => void;
  onBack: () => void;
};

export function useNewPaneViewModel(): NewPaneViewModel {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { terminalId, sessionName } = useParams({ from: "/terminals/$terminalId/sessions/$sessionName/panes/new/" });
  const { connection, connectionKey } = useMuximodConnection();
  const resources = useTerminalResources({ terminalId, sessionName });
  const workspacePicker = useWorkspacePickerViewModel({ initialMode: "worktree" });
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
  const existingPanes = panesQuery.data ?? [];
  const [name, setName] = useState("");
  const [kind, setKind] = useState<NewPaneKind>("agent");
  const [agentId, setAgentId] = useState<NewPaneAgent>("codex");
  const [placement, setPlacement] = useState<PanePlacement>("window");
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (placement !== "window" && !targetPaneId) setTargetPaneId(existingPanes[0]?.tmuxPaneId ?? null);
  }, [existingPanes, placement, targetPaneId]);

  useEffect(() => {
    if (kind === "agent" && workspacePicker.mode === "worktree" && workspacePicker.workspaces.length) {
      const selected = workspacePicker.workspaces.find((workspace) => workspace.id === workspacePicker.workspaceId) ?? workspacePicker.workspaces[0];
      if (!selected?.isGit) workspacePicker.onModeChange("workspace");
    }
  }, [kind, workspacePicker]);

  return {
    terminal: resources.selectedTerminal ?? fallbackTerminal,
    session: resources.selectedSession ?? fallbackSession,
    name,
    workspacePicker,
    kind,
    agentId,
    existingPanes,
    placement,
    targetPaneId,
    isCreating,
    errorMessage,
    onNameChange: setName,
    onKindChange: (nextKind) => {
      setKind(nextKind);
      if (nextKind === "shell") {
        workspacePicker.onModeChange("workspace");
        return;
      }
      const selected = workspacePicker.workspaces.find((workspace) => workspace.id === workspacePicker.workspaceId) ?? workspacePicker.workspaces[0];
      if (selected?.isGit) workspacePicker.onModeChange("worktree");
    },
    onAgentChange: setAgentId,
    onPlacementChange: (nextPlacement) => {
      setPlacement(nextPlacement);
      if (nextPlacement !== "window" && !targetPaneId) setTargetPaneId(existingPanes[0]?.tmuxPaneId ?? null);
    },
    onTargetPaneChange: setTargetPaneId,
    onCreate: () => {
      const useWorktree = workspacePicker.mode === "worktree";
      const workspaceRequired = useWorktree || (kind === "agent" && placement === "window");
      const workspaceId = workspaceRequired ? workspacePicker.workspaceId || existingPanes[0]?.workspaceId : undefined;
      if (!connection || !resources.selectedSession || !name.trim() || (workspaceRequired && (!workspaceId || !workspacePickerState(workspacePicker).canContinue)) || (placement !== "window" && !targetPaneId) || isCreating) return;
      setIsCreating(true);
      setErrorMessage(null);
      void createPane({
        sessionName: resources.selectedSession.name,
        kind,
        name: name.trim(),
        ...(workspaceId ? { workspaceId } : {}),
        agentId: kind === "agent" ? agentId : null,
        useWorktree,
        placement,
        targetPaneId: placement === "window" ? null : targetPaneId,
      }, connection)
        .then((pane) => {
          queryClient.setQueryData<PaneSummary[]>(paneQueryKey(connection, resources.selectedSession?.name), (current) => [
            ...(current ?? []).filter((candidate) => candidate.id !== pane.id),
            pane,
          ]);
          void queryClient.invalidateQueries({ queryKey: paneQueryKey(connection, resources.selectedSession?.name) });
          void navigate({ to: "/terminals/$terminalId/sessions/$sessionName/panes/$paneId", params: { terminalId, sessionName: resources.selectedSession!.name, paneId: pane.id } });
        })
        .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setIsCreating(false));
    },
    onBack: () => {
      void navigate({ to: "/terminals/$terminalId/sessions/$sessionName", params: { terminalId, sessionName } });
    },
  };
}
