import type { ConnectionFlowViewModel, TerminalEndpoint, TmuxSession } from "./connection-flow-viewmodel";
import { ConnectionSettingsView } from "./connection-settings-view";

export function ConnectionFlowView({ viewModel }: { viewModel: ConnectionFlowViewModel }) {
  return (
    <main className="connection-flow">
      <header className="connection-flow-topbar">
        <div className="connection-flow-brand"><span className="connection-flow-mark">⌁</span><strong>agent<span>.</span></strong><small>connect</small></div>
        <div className="connection-flow-network"><span className="connection-flow-network-dot" /> TAILNET</div>
      </header>

      {viewModel.stage === "terminals" ? <TerminalPicker viewModel={viewModel} /> : null}
      {viewModel.stage === "sessions" ? <SessionPicker viewModel={viewModel} /> : null}
      {viewModel.stage === "connecting" ? <ConnectingView viewModel={viewModel} /> : null}
      {viewModel.stage === "disconnected" ? <DisconnectedView viewModel={viewModel} /> : null}
      {viewModel.stage === "ended" ? <EndedView viewModel={viewModel} /> : null}

      <footer className="connection-flow-footer">
        <span><span className="connection-flow-footer-dot" /> encrypted over your tailnet</span>
        <span>agentd</span>
      </footer>
    </main>
  );
}

function TerminalPicker({ viewModel }: { viewModel: ConnectionFlowViewModel }) {
  return (
    <div className="connection-flow-content">
      <FlowIntro step="STEP 1 / 2" title="Choose a terminal" description="Select the computer that owns the tmux sessions you want to control." />
      <section className="connection-flow-section" aria-label="available terminals">
        <div className="connection-flow-section-heading"><span>AVAILABLE TERMINALS</span><span className="connection-flow-section-tools"><small>{viewModel.terminals.filter((terminal) => terminal.state === "online").length} online</small><button className="connection-flow-inline-action" type="button" onClick={viewModel.onOpenSettings}>settings</button></span></div>
        {viewModel.status === "loading" ? <p className="connection-flow-note">Connecting to agentd…</p> : null}
        {viewModel.status === "error" ? <p className="connection-flow-note connection-flow-note-error" role="alert">{viewModel.errorMessage}</p> : null}
        <div className="connection-flow-card-list">
          {viewModel.terminals.map((terminal) => <TerminalCard key={terminal.id} terminal={terminal} onSelect={viewModel.onSelectTerminal} />)}
        </div>
      </section>
      <p className="connection-flow-note"><span className="connection-flow-note-icon">i</span> Your phone only connects to machines visible on this tailnet.</p>
    </div>
  );
}

function TerminalCard({ terminal, onSelect }: { terminal: TerminalEndpoint; onSelect: (terminal: TerminalEndpoint) => void }) {
  const online = terminal.state === "online";
  return (
    <button className={`connection-terminal-card${online ? "" : " connection-terminal-card-disabled"}`} type="button" disabled={!online} onClick={() => onSelect(terminal)}>
      <span className="connection-terminal-icon">⌁</span>
      <span className="connection-terminal-copy">
        <span className="connection-terminal-title"><strong>{terminal.name}</strong><span className={`connection-status-badge connection-status-${terminal.state}`}><span />{online ? "ONLINE" : "OFFLINE"}</span></span>
        <small>{terminal.host} · {terminal.tailnetIp}</small>
        <small>{terminal.detail} · {terminal.lastSeen}</small>
      </span>
      <span className="connection-card-chevron">›</span>
    </button>
  );
}

function SessionPicker({ viewModel }: { viewModel: ConnectionFlowViewModel }) {
  const terminal = viewModel.selectedTerminal;
  return (
    <div className="connection-flow-content">
      <button className="connection-flow-back" type="button" onClick={viewModel.onBack}>‹ <span>{terminal?.name ?? "terminal"}</span></button>
      <FlowIntro step="STEP 2 / 2" title="Choose a tmux session" description="Pick the workspace to open on your phone. The session stays alive when you disconnect." />
      {terminal ? <div className="connection-selected-terminal"><span className="connection-flow-network-dot" /><span>{terminal.name}</span><small>{terminal.tailnetIp}</small></div> : null}
      <section className="connection-flow-section" aria-label="tmux sessions">
        <div className="connection-flow-section-heading">
          <span>TMUX SESSIONS</span>
          <span className="connection-flow-section-tools"><small>{viewModel.sessions.length} found</small><button className="connection-flow-inline-action" type="button" onClick={viewModel.onCreateSession}>+ new session</button></span>
        </div>
        {viewModel.status === "loading" ? <p className="connection-flow-note">Reading tmux sessions…</p> : null}
        {viewModel.status === "error" ? <p className="connection-flow-note connection-flow-note-error" role="alert">{viewModel.errorMessage}</p> : null}
        <div className="connection-flow-card-list">
          {viewModel.sessions.map((session) => <SessionCard key={session.name} session={session} selected={session.name === viewModel.selectedSession?.name} onSelect={viewModel.onSelectSession} />)}
        </div>
      </section>
      <p className="connection-flow-note"><span className="connection-flow-note-icon">↗</span> Tap a session to connect. The session overview opens before any pane is attached.</p>
    </div>
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

function ConnectingView({ viewModel }: { viewModel: ConnectionFlowViewModel }) {
  const terminal = viewModel.selectedTerminal;
  const session = viewModel.selectedSession;
  const steps = ["Reach terminal over Tailscale", "Authenticate with agentd", `Attach to ${session?.name ?? "tmux"}`];
  return (
    <div className="connection-flow-content connection-flow-centered">
      <span className="connection-flow-loader" aria-hidden="true"><span /><span /><span /></span>
      <FlowIntro step="CONNECTING" title="Opening your workspace" description={`${terminal?.name ?? "Terminal"} · ${session?.name ?? "tmux session"}`} />
      <div className="connection-progress-list">
        {steps.map((step, index) => <div className={`connection-progress-step${index < viewModel.connectionStep ? " connection-progress-step-done" : index === viewModel.connectionStep ? " connection-progress-step-active" : ""}`} key={step}><span>{index < viewModel.connectionStep ? "✓" : index + 1}</span><small>{step}</small></div>)}
      </div>
      <button className="connection-flow-primary" type="button" onClick={viewModel.onOpenSessionOverview}>Open session overview<span>→</span></button>
      <button className="connection-flow-secondary" type="button" onClick={viewModel.onBack}>Cancel</button>
    </div>
  );
}

function DisconnectedView({ viewModel }: { viewModel: ConnectionFlowViewModel }) {
  const terminal = viewModel.selectedTerminal;
  const session = viewModel.selectedSession;
  return (
    <div className="connection-flow-content connection-flow-centered">
      <div className="connection-disconnected-mark">↯</div>
      <FlowIntro step="DISCONNECTED" title="Mobile is disconnected" description="The tmux session is still running on the terminal." />
      <div className="connection-summary-card"><span><small>TERMINAL</small><strong>{terminal?.name}</strong><em>{terminal?.tailnetIp}</em></span><span><small>SESSION</small><strong>{session?.name}</strong><em>session preserved</em></span></div>
      <button className="connection-flow-primary" type="button" onClick={viewModel.onReconnect}>Reconnect to session<span>→</span></button>
      <button className="connection-flow-secondary" type="button" onClick={viewModel.onChooseTerminal}>Choose another terminal</button>
    </div>
  );
}

function EndedView({ viewModel }: { viewModel: ConnectionFlowViewModel }) {
  const session = viewModel.selectedSession;
  return (
    <div className="connection-flow-content connection-flow-centered">
      <div className="connection-ended-mark">×</div>
      <FlowIntro step="SHELL ENDED" title="The shell has closed" description={`${session?.name ?? "tmux session"} is no longer attached to this phone.`} />
      <div className="connection-ended-card"><span><small>PROCESS</small><strong>zsh</strong></span><span><small>EXIT</small><strong>0</strong></span><span><small>SESSION</small><strong>{session?.name ?? "—"}</strong></span></div>
      <p className="connection-flow-note"><span className="connection-flow-note-icon">i</span> The tmux session is still available. Reconnecting will not create a duplicate shell.</p>
      <button className="connection-flow-primary" type="button" onClick={viewModel.onReconnect}>Reconnect to session<span>→</span></button>
      <button className="connection-flow-secondary" type="button" onClick={viewModel.onChooseTerminal}>Choose another terminal</button>
    </div>
  );
}

function FlowIntro({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="connection-flow-intro">
      <span className="connection-flow-step"><span className="connection-flow-step-line" />{step}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
