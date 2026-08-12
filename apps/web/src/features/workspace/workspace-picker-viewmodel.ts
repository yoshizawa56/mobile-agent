import type { WorkspaceDirectory } from "@mobile-agent/protocol";

export type WorkspacePickerStatus = "loading" | "ready" | "error";
export type WorkspaceSelectionMode = "workspace" | "worktree";

export type WorkspacePickerInput = {
  workspaces: WorkspaceDirectory[];
  workspaceCandidates: WorkspaceDirectory[];
  workspaceId: string;
  mode: WorkspaceSelectionMode;
  workspaceStatus: WorkspacePickerStatus;
  browserStatus: WorkspacePickerStatus;
  browserPath: string | null;
  registrationOpen: boolean;
  registrationDirectory: string;
  setupScriptPath: string;
  cleanupScriptPath: string;
  isRegisteringWorkspace: boolean;
  registrationError: string | null;
  errorMessage: string | null;
};

export type WorkspacePickerState = {
  selectedWorkspace: WorkspaceDirectory | null;
  canContinue: boolean;
  modeHelp: string;
};

export type WorkspacePickerViewModel = WorkspacePickerInput & {
  onWorkspaceChange: (workspaceId: string) => void;
  onModeChange: (mode: WorkspaceSelectionMode) => void;
  onOpenRegistration: () => void;
  onCloseRegistration: () => void;
  onBrowseWorkspace: (path?: string) => void;
  onSelectWorkspaceDirectory: (directory: string) => void;
  onRegistrationDirectoryChange: (directory: string) => void;
  onSetupScriptPathChange: (path: string) => void;
  onCleanupScriptPathChange: (path: string) => void;
  onRegisterWorkspace: () => void;
};

export function workspacePickerState(input: WorkspacePickerInput): WorkspacePickerState {
  const selectedWorkspace = input.workspaces.find((workspace) => workspace.id === input.workspaceId) ?? null;
  const canContinue = input.workspaceStatus === "ready"
    && Boolean(selectedWorkspace)
    && (input.mode === "workspace" || Boolean(selectedWorkspace?.isGit));

  return {
    selectedWorkspace,
    canContinue,
    modeHelp: input.mode === "worktree"
      ? "The host creates an isolated git worktree and runs the registered workspace hooks with the worktree as cwd."
      : "Open the selected workspace directory directly.",
  };
}

export function workspacePickerErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}
