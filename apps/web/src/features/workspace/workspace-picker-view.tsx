import type { WorkspacePickerViewModel } from "./workspace-picker-viewmodel";
import { workspacePickerState } from "./workspace-picker-viewmodel";

export function WorkspacePickerView({ viewModel, showMode = true }: { viewModel: WorkspacePickerViewModel; showMode?: boolean }) {
  const state = workspacePickerState(viewModel);
  const workspaceUnavailable = viewModel.workspaceStatus === "error" || (viewModel.workspaceStatus === "ready" && !viewModel.workspaces.length);

  return (
    <>
      <label className="new-session-field">
        <span>REGISTERED WORKSPACE</span>
        <select
          value={viewModel.workspaceId}
          onChange={(event) => viewModel.onWorkspaceChange(event.target.value)}
          disabled={viewModel.workspaceStatus === "loading" || workspaceUnavailable}
          aria-describedby="workspace-picker-help"
        >
          <option value="">
            {viewModel.workspaceStatus === "loading" ? "Loading workspaces…" : workspaceUnavailable ? "No registered workspaces" : "Choose a workspace"}
          </option>
          {viewModel.workspaces.map((workspace) => (
            <option value={workspace.id} key={workspace.id}>
              {workspace.name} · {workspace.directory}
            </option>
          ))}
        </select>
        <small id="workspace-picker-help">Choose a workspace registered on the host. The host keeps its directory and hook paths.</small>
      </label>

      <button className="workspace-picker-register" type="button" onClick={viewModel.onOpenRegistration}>
        {viewModel.registrationOpen ? "Workspace registration" : "+ Register workspace"}
      </button>

      {viewModel.workspaceStatus === "error" ? <p className="new-session-error" role="alert">{viewModel.errorMessage ?? "Could not load registered workspaces"}</p> : null}
      {viewModel.workspaceStatus === "ready" && !viewModel.workspaces.length ? <p className="workspace-picker-empty">No workspace is registered on this host yet.</p> : null}

      {viewModel.registrationOpen ? (
        <section className="workspace-picker-registration" aria-label="Register workspace">
          <div className="workspace-picker-registration-heading">
            <div>
              <strong>Register a workspace</strong>
              <small>Pick a host directory, then optionally attach personal executable hooks.</small>
            </div>
            <button type="button" onClick={viewModel.onCloseRegistration}>Close</button>
          </div>

          <label className="new-session-field">
            <span>DIRECTORY</span>
            <input
              value={viewModel.registrationDirectory}
              onChange={(event) => viewModel.onRegistrationDirectoryChange(event.target.value)}
              placeholder="/Users/me/work/mobile-agent"
              autoComplete="off"
            />
          </label>

          <div className="workspace-picker-browser-actions">
            <button type="button" onClick={() => viewModel.onBrowseWorkspace(viewModel.registrationDirectory.trim() || undefined)} disabled={viewModel.browserStatus === "loading"}>
              {viewModel.browserStatus === "loading" ? "Browsing…" : "Browse directory"}
            </button>
            <button type="button" onClick={() => viewModel.onBrowseWorkspace()} disabled={viewModel.browserStatus === "loading"}>Allowed roots</button>
          </div>

          {viewModel.browserPath ? <small className="workspace-picker-browser-path">Browsing: {viewModel.browserPath}</small> : null}
          {viewModel.browserStatus === "error" ? <p className="new-session-error" role="alert">{viewModel.errorMessage ?? "Could not browse host directories"}</p> : null}
          {viewModel.browserStatus === "ready" && viewModel.workspaceCandidates.length ? (
            <div className="workspace-picker-directory-list">
              {viewModel.workspaceCandidates.map((candidate) => (
                <div className="workspace-picker-directory" key={candidate.directory}>
                  <button type="button" className="workspace-picker-directory-select" onClick={() => viewModel.onSelectWorkspaceDirectory(candidate.directory)}>
                    <strong>{candidate.name}</strong><small>{candidate.directory}</small>
                  </button>
                  <button type="button" onClick={() => viewModel.onBrowseWorkspace(candidate.directory)}>Open</button>
                </div>
              ))}
            </div>
          ) : null}

          <label className="new-session-field">
            <span>SETUP SCRIPT PATH <small>(OPTIONAL)</small></span>
            <input value={viewModel.setupScriptPath} onChange={(event) => viewModel.onSetupScriptPathChange(event.target.value)} placeholder="/Users/me/.config/agent/setup" autoComplete="off" />
          </label>
          <label className="new-session-field">
            <span>CLEANUP SCRIPT PATH <small>(OPTIONAL)</small></span>
            <input value={viewModel.cleanupScriptPath} onChange={(event) => viewModel.onCleanupScriptPathChange(event.target.value)} placeholder="/Users/me/.config/agent/cleanup" autoComplete="off" />
          </label>
          <small className="workspace-picker-hook-help">Hook paths are host-side executable files and are not expected inside the worktree. They run with the created worktree as the current directory.</small>

          <label className="new-session-field">
            <span>WORKTREE COPY PATTERNS <small>(OPTIONAL · ONE PER LINE)</small></span>
            <textarea
              value={viewModel.worktreeCopyPatterns}
              onChange={(event) => viewModel.onWorktreeCopyPatternsChange(event.target.value)}
              placeholder={".env\n.env.local\nconfig/*.local.json"}
              rows={4}
              spellCheck={false}
            />
          </label>
          <small className="workspace-picker-hook-help">Relative patterns such as <code>.env</code> or <code>config/**/*.local.json</code> copy unmanaged files before the setup hook runs.</small>

          {viewModel.registrationError ? <p className="new-session-error" role="alert">{viewModel.registrationError}</p> : null}
          <button
            className="connection-flow-primary workspace-picker-submit"
            type="button"
            onClick={viewModel.onRegisterWorkspace}
            disabled={viewModel.isRegisteringWorkspace || !viewModel.registrationDirectory.trim()}
          >
            {viewModel.isRegisteringWorkspace ? "Registering…" : "Register workspace"}<span>{viewModel.isRegisteringWorkspace ? "…" : "→"}</span>
          </button>
        </section>
      ) : null}

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
              <span><strong>Git worktree</strong><small>{state.selectedWorkspace?.isGit ? "Create an isolated branch workspace." : "Available for git directories only."}</small></span>
            </label>
          </div>
          <small className="workspace-mode-help">{state.modeHelp}</small>
        </fieldset>
      ) : null}
    </>
  );
}
