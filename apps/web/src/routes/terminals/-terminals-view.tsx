import { ConnectionFlowLayout, FlowIntro } from "../../features/connection/connection-flow-layout";
import type { TerminalEndpoint } from "../../features/connection/connection-flow-viewmodel";
import type { TerminalsViewModel } from "./-terminals-viewmodel";

export function TerminalsView({ viewModel }: { viewModel: TerminalsViewModel }) {
  return (
    <ConnectionFlowLayout>
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
    </ConnectionFlowLayout>
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
