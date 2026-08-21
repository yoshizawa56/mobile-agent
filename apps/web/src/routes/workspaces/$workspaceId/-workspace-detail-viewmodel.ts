import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMobileExperience } from "../../../app/mobile-experience-context";
import { deleteWorkspace, fetchWorkspaces, updateWorkspace } from "../../../features/api/muximod-api";
import { connectionForProfile, readBrowserConnectionProfile } from "../../../features/connection/connection-profile-store";
import { workspacesPath } from "../../../app/workspace-routes";
import { parseWorktreeCopyPatterns, workspaceDetailCanSave } from "../../../features/workspace/workspaces-viewmodel";
import type { WorkspaceDetailViewModel } from "../../../features/workspace/workspaces-viewmodel";

export function useWorkspaceDetailViewModel(workspaceId: string): WorkspaceDetailViewModel {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = readBrowserConnectionProfile();
  const muximodConnection = connectionForProfile(profile);
  const connectionKey = muximodConnection ? `${muximodConnection.route ?? "custom"}:${muximodConnection.httpBaseUrl}` : "unconfigured";

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", connectionKey],
    queryFn: () => {
      if (!muximodConnection) throw new Error("Connection profile is not configured");
      return fetchWorkspaces(muximodConnection);
    },
    enabled: Boolean(muximodConnection),
    staleTime: 5_000,
  });

  const workspace = useMemo(() => (workspacesQuery.data ?? []).find((w) => w.id === workspaceId) ?? null, [workspacesQuery.data, workspaceId]);

  const [name, setName] = useState("");
  const [setupScriptPath, setSetupScriptPath] = useState("");
  const [cleanupScriptPath, setCleanupScriptPath] = useState("");
  const [worktreeCopyPatterns, setWorktreeCopyPatterns] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    setName(workspace.name);
    setSetupScriptPath(workspace.setupScriptPath ?? "");
    setCleanupScriptPath(workspace.cleanupScriptPath ?? "");
    setWorktreeCopyPatterns((workspace.worktreeCopyPatterns ?? []).join("\n"));
    setSaveError(null);
  }, [workspace]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!muximodConnection) throw new Error("Connection profile is not configured");
      const patterns = parseWorktreeCopyPatterns(worktreeCopyPatterns);
      return updateWorkspace(workspaceId, {
        name: name.trim() || undefined,
        setupScriptPath: setupScriptPath.trim() ? setupScriptPath.trim() : null,
        cleanupScriptPath: cleanupScriptPath.trim() ? cleanupScriptPath.trim() : null,
        worktreeCopyPatterns: patterns,
      }, muximodConnection);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["workspaces", connectionKey], (current: unknown) => {
        const list = Array.isArray(current) ? current : [];
        return (list as typeof updated[]).map((w) => w.id === updated.id ? updated : w).sort((a, b) => a.name.localeCompare(b.name));
      });
      setSaveError(null);
    },
    onError: (error: unknown) => setSaveError(error instanceof Error ? error.message : String(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!muximodConnection) throw new Error("Connection profile is not configured");
      return deleteWorkspace(workspaceId, muximodConnection);
    },
    onSuccess: () => {
      queryClient.setQueryData(["workspaces", connectionKey], (current: unknown) => {
        const list = Array.isArray(current) ? current : [];
        return (list as { id: string }[]).filter((w) => w.id !== workspaceId);
      });
      void navigate({ to: workspacesPath() });
    },
    onError: (error: unknown) => setSaveError(error instanceof Error ? error.message : String(error)),
  });

  const onSave = useCallback(() => {
    if (!workspaceDetailCanSave(name)) {
      setSaveError("Workspace name cannot be empty or exceed 120 characters");
      return;
    }
    updateMutation.mutate();
  }, [name, updateMutation]);

  const onDelete = useCallback(() => {
    if (!window.confirm(`Unregister workspace "${workspace?.name ?? workspaceId}"? Directory will not be deleted.`)) return;
    deleteMutation.mutate();
  }, [workspace, workspaceId, deleteMutation]);

  const onBack = useCallback(() => {
    void navigate({ to: workspacesPath() });
  }, [navigate]);

  return {
    workspace,
    workspaces: workspacesQuery.data ?? [],
    status: workspacesQuery.status === "pending" ? "loading" : workspacesQuery.status === "error" ? "error" : "ready",
    name,
    setupScriptPath,
    cleanupScriptPath,
    worktreeCopyPatterns,
    isSaving: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    errorMessage: workspacesQuery.error instanceof Error ? workspacesQuery.error.message : workspacesQuery.error ? String(workspacesQuery.error) : null,
    saveError,
    canSave: workspaceDetailCanSave(name),
    onNameChange: setName,
    onSetupScriptPathChange: setSetupScriptPath,
    onCleanupScriptPathChange: setCleanupScriptPath,
    onWorktreeCopyPatternsChange: setWorktreeCopyPatterns,
    onSave,
    onDelete,
    onBack,
  };
}
