import type { PanePlacement, PaneSummary } from "@mobile-agent/protocol";
import type { TerminalEndpoint, TmuxSession } from "../connection/connection-flow-viewmodel";

export type NewPaneKind = "agent" | "shell";
export type NewPaneAgent = "codex" | "claude";

export type NewPaneViewModel = {
  terminal: TerminalEndpoint;
  session: TmuxSession;
  name: string;
  cwd: string;
  kind: NewPaneKind;
  agentId: NewPaneAgent;
  useWorktree: boolean;
  projectName: string;
  existingPanes: PaneSummary[];
  placement: PanePlacement;
  targetPaneId: string | null;
  isCreating: boolean;
  errorMessage: string | null;
  onNameChange: (value: string) => void;
  onCwdChange: (value: string) => void;
  onKindChange: (value: NewPaneKind) => void;
  onAgentChange: (value: NewPaneAgent) => void;
  onUseWorktreeChange: (value: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onPlacementChange: (value: PanePlacement) => void;
  onTargetPaneChange: (value: string) => void;
  onCreate: () => void;
  onBack: () => void;
};

export function NewPaneView({ viewModel }: { viewModel: NewPaneViewModel }) {
  const canCreate = viewModel.name.trim().length > 0
    && viewModel.cwd.trim().length > 0
    && (!viewModel.useWorktree || viewModel.projectName.trim().length > 0)
    && (viewModel.placement === "window" || Boolean(viewModel.targetPaneId));

  return (
    <main className="new-session-view new-pane-view">
      <header className="new-session-toolbar">
        <button className="new-session-back" type="button" onClick={viewModel.onBack}>‹ <span>{viewModel.session.name}</span></button>
        <span className="new-session-terminal"><span /> {viewModel.terminal.name}</span>
      </header>
      <section className="new-session-content">
        <div className="connection-flow-intro">
          <span className="connection-flow-step"><span className="connection-flow-step-line" /> NEW PANE</span>
          <h1>Open a pane</h1>
          <p>Start a shell or an agent inside <strong>{viewModel.session.name}</strong>. The pane remains a normal tmux pane on your host.</p>
        </div>

        <form className="new-session-form" onSubmit={(event) => { event.preventDefault(); if (canCreate) viewModel.onCreate(); }}>
          <label className="new-session-field">
            <span>PANE NAME</span>
            <input value={viewModel.name} onChange={(event) => viewModel.onNameChange(event.target.value)} placeholder="review" autoComplete="off" />
            <small>Shown in the pane board and layout map.</small>
          </label>

          <fieldset className="new-pane-choice-group">
            <legend>PANE TYPE</legend>
            <div className="new-pane-choice-list">
              <label className={`new-pane-choice${viewModel.kind === "agent" ? " new-pane-choice-selected" : ""}`}>
                <input type="radio" name="pane-kind" checked={viewModel.kind === "agent"} onChange={() => viewModel.onKindChange("agent")} />
                <span><strong>Agent</strong><small>Launch Codex or Claude through agent</small></span>
              </label>
              <label className={`new-pane-choice${viewModel.kind === "shell" ? " new-pane-choice-selected" : ""}`}>
                <input type="radio" name="pane-kind" checked={viewModel.kind === "shell"} onChange={() => viewModel.onKindChange("shell")} />
                <span><strong>Shell</strong><small>Open the host's default shell</small></span>
              </label>
            </div>
          </fieldset>

          <fieldset className="new-pane-choice-group">
            <legend>OPEN IN</legend>
            <div className="new-pane-placement-list">
              <label className={`new-pane-placement${viewModel.placement === "window" ? " new-pane-placement-selected" : ""}`}>
                <input type="radio" name="pane-placement" checked={viewModel.placement === "window"} onChange={() => viewModel.onPlacementChange("window")} />
                <span><strong>New window</strong><small>Keep the pane full-size in its own tmux window.</small></span>
              </label>
              <label className={`new-pane-placement${viewModel.placement === "right" ? " new-pane-placement-selected" : ""}`}>
                <input type="radio" name="pane-placement" checked={viewModel.placement === "right"} onChange={() => viewModel.onPlacementChange("right")} disabled={!viewModel.existingPanes.length} />
                <span><strong>Split right</strong><small>Place it beside an existing pane.</small></span>
              </label>
              <label className={`new-pane-placement${viewModel.placement === "bottom" ? " new-pane-placement-selected" : ""}`}>
                <input type="radio" name="pane-placement" checked={viewModel.placement === "bottom"} onChange={() => viewModel.onPlacementChange("bottom")} disabled={!viewModel.existingPanes.length} />
                <span><strong>Split below</strong><small>Place it beneath an existing pane.</small></span>
              </label>
            </div>
          </fieldset>

          {viewModel.placement !== "window" ? (
            <label className="new-session-field">
              <span>SPLIT FROM</span>
              <select value={viewModel.targetPaneId ?? ""} onChange={(event) => viewModel.onTargetPaneChange(event.target.value)}>
                {viewModel.existingPanes.map((pane) => <option value={pane.tmuxPaneId} key={pane.id}>{pane.name} · {pane.tmuxPaneId}</option>)}
              </select>
              <small>The new pane will be created relative to this tmux pane.</small>
            </label>
          ) : null}

          {viewModel.kind === "agent" ? (
            <>
              <label className="new-session-field">
                <span>AGENT</span>
                <select value={viewModel.agentId} onChange={(event) => viewModel.onAgentChange(event.target.value as NewPaneAgent)}>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
                </select>
              </label>
              <label className="new-pane-toggle">
                <input type="checkbox" checked={viewModel.useWorktree} onChange={(event) => viewModel.onUseWorktreeChange(event.target.checked)} />
                <span><strong>Use a worktree</strong><small>Let the agent command create an isolated branch workspace.</small></span>
              </label>
              {viewModel.useWorktree ? <label className="new-session-field">
                <span>PROJECT NAME</span>
                <input value={viewModel.projectName} onChange={(event) => viewModel.onProjectNameChange(event.target.value)} placeholder="mobile-agent" autoComplete="off" />
                <small>Used by the host-side agent project configuration.</small>
              </label> : null}
            </>
          ) : null}

          <label className="new-session-field">
            <span>WORKING DIRECTORY</span>
            <input value={viewModel.cwd} onChange={(event) => viewModel.onCwdChange(event.target.value)} placeholder="~/work/project" autoComplete="off" />
          </label>
          {viewModel.errorMessage ? <p className="new-session-error" role="alert">{viewModel.errorMessage}</p> : null}
          <button className="connection-flow-primary" type="submit" disabled={!canCreate || viewModel.isCreating}>{viewModel.isCreating ? "Opening pane…" : "Open pane"}<span>{viewModel.isCreating ? "…" : "→"}</span></button>
        </form>
      </section>
    </main>
  );
}
