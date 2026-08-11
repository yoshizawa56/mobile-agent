import type { WorkspacePickerViewModel } from "./workspace-picker-viewmodel";
import { workspacePickerState } from "./workspace-picker-viewmodel";

export function WorkspacePickerView({ viewModel, showMode = true }: { viewModel: WorkspacePickerViewModel; showMode?: boolean }) {
  const state = workspacePickerState(viewModel);
  const workspaceUnavailable = viewModel.workspaceStatus === "error" || (viewModel.workspaceStatus === "ready" && !viewModel.workspaces.length);

  return (
    <>
      <label className="new-session-field">
        <span>WORKSPACE DIRECTORY</span>
        <select
          value={viewModel.workspaceId}
          onChange={(event) => viewModel.onWorkspaceChange(event.target.value)}
          disabled={viewModel.workspaceStatus === "loading" || workspaceUnavailable}
          aria-describedby="workspace-picker-help"
        >
          <option value="">
            {viewModel.workspaceStatus === "loading" ? "Loading directories…" : workspaceUnavailable ? "No allowed directories" : "Choose a directory"}
          </option>
          {viewModel.workspaces.map((workspace) => (
            <option value={workspace.id} key={workspace.id}>
              {workspace.name} · {workspace.directory}
            </option>
          ))}
        </select>
        <small id="workspace-picker-help">Only directories allowed by the host policy are available.</small>
      </label>

      {viewModel.workspaceStatus === "error" ? <p className="new-session-error" role="alert">{viewModel.errorMessage ?? "Could not load workspace directories"}</p> : null}
      {viewModel.workspaceStatus === "ready" && !viewModel.workspaces.length ? <p className="workspace-picker-empty">No workspace directories are allowed on this host.</p> : null}

      {showMode ? (
        <fieldset className="new-pane-choice-group workspace-mode-group">
          <legend>WORKSPACE MODE</legend>
          <div className="new-pane-choice-list">
            <label className={`new-pane-choice${viewModel.mode === "workspace" ? " new-pane-choice-selected" : ""}`}>
              <input type="radio" name="workspace-mode" checked={viewModel.mode === "workspace"} onChange={() => viewModel.onModeChange("workspace")} />
              <span><strong>Workspace</strong><small>Use the selected directory directly.</small></span>
            </label>
            <label className={`new-pane-choice${viewModel.mode === "worktree" ? " new-pane-choice-selected" : ""}${state.selectedWorkspace?.isGit ? "" : " new-pane-choice-disabled"}`}>
              <input type="radio" name="workspace-mode" checked={viewModel.mode === "worktree"} onChange={() => viewModel.onModeChange("worktree")} disabled={!state.selectedWorkspace?.isGit} />
              <span><strong>Project worktree</strong><small>{state.selectedWorkspace?.isGit ? "Create an isolated branch workspace." : "Available for git directories only."}</small></span>
            </label>
          </div>
          <small className="workspace-mode-help">{state.modeHelp}</small>
        </fieldset>
      ) : null}

      {showMode && viewModel.mode === "worktree" ? (
        <label className="new-session-field">
          <span>PROJECT</span>
          <select
            value={viewModel.projectId ?? ""}
            onChange={(event) => viewModel.onProjectChange(event.target.value || null)}
            disabled={viewModel.projectStatus === "loading" || viewModel.projectStatus === "error" || !viewModel.projects.length}
          >
            <option value="">{viewModel.projectStatus === "loading" ? "Loading projects…" : "Choose a project"}</option>
            {viewModel.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
          <small>Project hooks are resolved on the host; no project path is entered here.</small>
        </label>
      ) : null}

      {showMode && viewModel.mode === "worktree" && viewModel.projectStatus === "error" ? <p className="new-session-error" role="alert">{viewModel.errorMessage ?? "Could not load projects"}</p> : null}
    </>
  );
}
