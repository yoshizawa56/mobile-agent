import type { ProjectOption, WorkspaceDirectory } from "@mobile-agent/protocol";

export type WorkspacePickerStatus = "loading" | "ready" | "error";
export type WorkspaceSelectionMode = "workspace" | "worktree";

export type WorkspacePickerInput = {
  workspaces: WorkspaceDirectory[];
  projects: ProjectOption[];
  workspaceId: string;
  mode: WorkspaceSelectionMode;
  projectId: string | null;
  workspaceStatus: WorkspacePickerStatus;
  projectStatus: WorkspacePickerStatus;
  errorMessage: string | null;
};

export type WorkspacePickerState = {
  selectedWorkspace: WorkspaceDirectory | null;
  selectedProject: ProjectOption | null;
  canContinue: boolean;
  modeHelp: string;
};

export type WorkspacePickerViewModel = WorkspacePickerInput & {
  onWorkspaceChange: (workspaceId: string) => void;
  onModeChange: (mode: WorkspaceSelectionMode) => void;
  onProjectChange: (projectId: string | null) => void;
};

export function workspacePickerState(input: WorkspacePickerInput): WorkspacePickerState {
  const selectedWorkspace = input.workspaces.find((workspace) => workspace.id === input.workspaceId) ?? null;
  const selectedProject = input.projects.find((project) => project.id === input.projectId) ?? null;
  const canContinue = input.workspaceStatus === "ready"
    && Boolean(selectedWorkspace)
    && (input.mode === "workspace"
      || (Boolean(selectedWorkspace?.isGit) && input.projectStatus === "ready" && Boolean(selectedProject)));

  return {
    selectedWorkspace,
    selectedProject,
    canContinue,
    modeHelp: input.mode === "worktree"
      ? "The host creates an isolated git worktree for this project."
      : "Open the selected workspace directory directly.",
  };
}

export function workspacePickerErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}
