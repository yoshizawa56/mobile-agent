import { ConnectionFlowLayout, FlowIntro } from "../../../../features/connection/connection-flow-layout";
import type { TmuxSession, TerminalEndpoint } from "../../../../features/connection/connection-flow-viewmodel";
import type { SessionsViewModel } from "./-sessions-viewmodel";

export function SessionsView({ viewModel }: { viewModel: SessionsViewModel }) {
  return (
    <ConnectionFlowLayout>
      <div className="connection-flow-content">
        <button className="connection-flow-back" type="button" onClick={viewModel.onBack}>‹ <span>{viewModel.selectedTerminal?.name ?? "terminal"}</span></button>
        <FlowIntro step="STEP 2 / 2" title="Choose a tmux session" description="Pick the workspace to open on your phone. The session stays alive when you disconnect." />
        {viewModel.selectedTerminal ? <div className="connection-selected-terminal"><span className="connection-flow-network-dot" /><span>{viewModel.selectedTerminal.name}</span><small>{viewModel.selectedTerminal.tailnetIp}</small></div> : null}
        <section className="connection-flow-section" aria-label="tmux sessions">
          <div className="connection-flow-section-heading"><span>TMUX SESSIONS</span><span className="connection-flow-section-tools"><small>{viewModel.sessions.length} found</small><button className="connection-flow-inline-action" type="button" onClick={viewModel.onCreateSession}>+ new session</button></span></div>
          {viewModel.status === "loading" ? <p className="connection-flow-note">Reading tmux sessions…</p> : null}
          {viewModel.status === "error" ? <p className="connection-flow-note connection-flow-note-error" role="alert">{viewModel.errorMessage}</p> : null}
          <div className="connection-flow-card-list">
            {viewModel.sessions.map((session) => <SessionCard key={session.name} session={session} selected={session.name === viewModel.selectedSession?.name} onSelect={viewModel.onSelectSession} />)}
          </div>
        </section>
        <p className="connection-flow-note"><span className="connection-flow-note-icon">↗</span> Tap a session to connect. The session overview opens before any pane is attached.</p>
      </div>
    </ConnectionFlowLayout>
  );
}

function SessionCard({ session, selected, onSelect }: { session: TmuxSession; selected: boolean; onSelect: (session: TmuxSession) => void }) {
  return (
    <button className={`connection-session-card${selected ? " connection-session-card-selected" : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(session)}>
      <span className="connection-session-icon">▦</span>
      <span className="connection-session-copy">
        <span className="connection-session-title"><strong>{session.name}</strong>{session.state === "active" ? <span className="connection-session-live">LIVE</span> : null}</span>
        <small>{session.cwd}</small>
        <small>{session.detail}</small>
      </span>
      <span className="connection-session-meta"><strong>{session.paneCount}</strong><small>panes</small>{session.waitingCount ? <em>{session.waitingCount} waiting</em> : null}</span>
    </button>
  );
}
