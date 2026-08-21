import type { WorkspaceDirectory } from "@muximo/protocol";

export type WorkspacesStatus = "loading" | "ready" | "error";

export type WorkspacesListViewModel = {
  workspaces: WorkspaceDirectory[];
  status: WorkspacesStatus;
  query: string;
  errorMessage: string | null;
  isRegistering: boolean;
  onQueryChange: (value: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onRegister: (input: { directory: string; name?: string }) => void;
  onOpenCreate: () => void;
  onBack: () => void;
};

export type WorkspaceDetailViewModel = {
  workspace: WorkspaceDirectory | null;
  workspaces: WorkspaceDirectory[];
  status: WorkspacesStatus;
  name: string;
  setupScriptPath: string;
  cleanupScriptPath: string;
  worktreeCopyPatterns: string;
  isSaving: boolean;
  isDeleting: boolean;
  errorMessage: string | null;
  saveError: string | null;
  canSave: boolean;
  onNameChange: (value: string) => void;
  onSetupScriptPathChange: (value: string) => void;
  onCleanupScriptPathChange: (value: string) => void;
  onWorktreeCopyPatternsChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onBack: () => void;
};

export function filterWorkspaces(workspaces: WorkspaceDirectory[], query: string): WorkspaceDirectory[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return workspaces;
  return workspaces.filter((workspace) =>
    workspace.name.toLowerCase().includes(needle) || workspace.directory.toLowerCase().includes(needle),
  );
}

export function workspaceDetailCanSave(name: string): boolean {
  return name.trim().length > 0 && name.trim().length <= 120 && !/[\u0000\r\n\t]/.test(name);
}

export function parseWorktreeCopyPatterns(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((pattern) => pattern.trim()).filter(Boolean))];
}
