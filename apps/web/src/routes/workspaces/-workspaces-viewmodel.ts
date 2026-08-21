import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMobileExperience } from "../../app/mobile-experience-context";
import { fetchWorkspaces, registerWorkspace } from "../../features/api/muximod-api";
import { connectionForProfile, readBrowserConnectionProfile } from "../../features/connection/connection-profile-store";
import { workspaceDetailPath } from "../../app/workspace-routes";
import type { WorkspacesListViewModel } from "../../features/workspace/workspaces-viewmodel";

export function useWorkspacesListViewModel(): WorkspacesListViewModel {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { connection } = useMobileExperience();
  const profile = readBrowserConnectionProfile();
  const muximodConnection = connectionForProfile(profile);
  const connectionKey = muximodConnection ? `${muximodConnection.route ?? "custom"}:${muximodConnection.httpBaseUrl}` : "unconfigured";

  const [query, setQuery] = useState("");
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", connectionKey],
    queryFn: () => {
      if (!muximodConnection) throw new Error("Connection profile is not configured");
      return fetchWorkspaces(muximodConnection);
    },
    enabled: Boolean(muximodConnection),
    staleTime: 5_000,
  });

  const registerMutation = useMutation({
    mutationFn: (input: { directory: string; name?: string }) => {
      if (!muximodConnection) throw new Error("Connection profile is not configured");
      return registerWorkspace(input, muximodConnection);
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(["workspaces", connectionKey], (current: unknown) => {
        const list = Array.isArray(current) ? current : [];
        const next = [...(list as typeof workspace[]).filter((w) => w.id !== workspace.id), workspace];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      void navigate({ to: workspaceDetailPath(workspace.id) });
    },
  });

  const onSelectWorkspace = useCallback((workspaceId: string) => {
    void navigate({ to: workspaceDetailPath(workspaceId) });
  }, [navigate]);

  const onBack = useCallback(() => {
    void navigate({ to: "/terminals" });
  }, [navigate]);

  const onOpenCreate = useCallback(() => {
    // Reuse existing picker flow: navigate to detail with empty id handled as create
    // For now prompt for directory; full browse UI can be integrated later
    const directory = window.prompt("Workspace directory (host absolute path)");
    if (!directory?.trim()) return;
    registerMutation.mutate({ directory: directory.trim() });
  }, [registerMutation]);

  return {
    workspaces: workspacesQuery.data ?? [],
    status: workspacesQuery.status === "pending" ? "loading" : workspacesQuery.status === "error" ? "error" : "ready",
    query,
    errorMessage: workspacesQuery.error instanceof Error ? workspacesQuery.error.message : workspacesQuery.error ? String(workspacesQuery.error) : null,
    isRegistering: registerMutation.isPending,
    onQueryChange: setQuery,
    onSelectWorkspace,
    onRegister: (input) => registerMutation.mutate(input),
    onOpenCreate,
    onBack,
  };
}

// Keep compatibility for routeTree expectations
export function useWorkspacesViewModel() {
  return useWorkspacesListViewModel();
}
