import { PaneLayoutOverlay } from "../pane-board/pane-layout-overlay-view";
import type { SessionOverviewViewModel } from "./session-overview-viewmodel";

export function SessionOverviewView({ viewModel }: { viewModel: SessionOverviewViewModel }) {
  return (
    <main className="session-overview">
      <header className="session-overview-toolbar">
        <button className="session-overview-back" type="button" onClick={viewModel.onBack} aria-label="Back to sessions">‹</button>
        <div className="session-overview-identity">
          <span className="session-overview-status"><span /> CONNECTED</span>
          <strong>{viewModel.session.name}</strong>
          <small>{viewModel.terminal.name} · {viewModel.session.cwd}</small>
        </div>
        <button className="session-overview-disconnect" type="button" onClick={viewModel.onDisconnect}>×</button>
      </header>

      <section className="session-overview-content">
        <div className="session-overview-intro">
          <span className="connection-flow-step"><span className="connection-flow-step-line" /> SESSION READY</span>
          <div className="session-overview-title-row"><h1>{viewModel.panes.length ? "Select a pane" : "No pane selected"}</h1><button className="session-overview-add-pane" type="button" onClick={viewModel.onCreatePane}>+ pane</button></div>
          <p>{viewModel.panes.length ? "Choose a pane to start viewing and interacting with it." : "Create a shell or agent pane to start working in this session."}</p>
        </div>
        <div className="session-overview-map-shell">
          {viewModel.status === "loading" ? <p className="pane-picker-message">Reading tmux layout…</p> : null}
          {viewModel.status === "error" ? <p className="pane-picker-message error-text">{viewModel.errorMessage}</p> : null}
          {viewModel.status !== "loading" && viewModel.status !== "error" ? <PaneLayoutOverlay panes={viewModel.panes} selectedTarget="" onSelect={viewModel.onSelectPane} variant="ghost" /> : null}
        </div>
        <p className="session-overview-hint"><span>⌁</span> The session stays alive while you switch panes.</p>
      </section>
    </main>
  );
}
