import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { TmuxSession } from "@muximo/api";
import { createSession } from "../../../../../app/api/muximod-api";
import { useMuximodConnection } from "../../../../../app/api/use-muximod-connection";
import type { TerminalEndpoint } from "../../../-connection-flow-viewmodel";
import { fallbackTerminal, useTerminalResources } from "../../../-terminal-resources";
import { useWorkspacePickerViewModel, workspacePickerState, type WorkspacePickerViewModel } from "../-workspace-picker-viewmodel";

export type NewSessionViewModel = {
  terminal: TerminalEndpoint;
  name: string;
  workspacePicker: WorkspacePickerViewModel;
  isCreating?: boolean;
  errorMessage?: string | null;
  onNameChange: (value: string) => void;
  onBack: () => void;
  onCreate: () => void;
};

export function useNewSessionViewModel(): NewSessionViewModel {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { terminalId } = useParams({ from: "/terminals/$terminalId/sessions/new/" });
  const { connection, connectionKey } = useMuximodConnection();
  const { selectedTerminal } = useTerminalResources({ terminalId });
  const workspacePicker = useWorkspacePickerViewModel();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return {
    terminal: selectedTerminal ?? fallbackTerminal,
    name,
    workspacePicker,
    isCreating,
    errorMessage,
    onNameChange: setName,
    onBack: () => {
      void navigate({ to: "/terminals/$terminalId/sessions", params: { terminalId } });
    },
    onCreate: () => {
      const workspaceId = workspacePicker.workspaceId;
      if (!connection || !name.trim() || !workspacePickerState(workspacePicker).canContinue || !workspaceId || isCreating) return;
      setIsCreating(true);
      setErrorMessage(null);
      void createSession({ name: name.trim(), workspaceId }, connection)
        .then((session) => {
          queryClient.setQueryData<TmuxSession[]>(["sessions", connectionKey, terminalId], (current) => [
            ...(current ?? []).filter((candidate) => candidate.name !== session.name),
            session,
          ]);
          void navigate({ to: "/terminals/$terminalId/sessions/$sessionName", params: { terminalId, sessionName: session.name } });
        })
        .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setIsCreating(false));
    },
  };
}
