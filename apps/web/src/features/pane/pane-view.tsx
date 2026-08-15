import type { PaneViewModel } from "./pane-viewmodel";
import { AppIcon } from "../../app-icon";
import { PaneBoardView } from "../pane-board/pane-board-view";
import type { PaneBoardViewModel } from "../pane-board/pane-board-viewmodel";
import type { PaneLayoutOverlayVariant } from "../pane-board/pane-layout-overlay-view";
import { useWindowMapGesture } from "./window-map-gesture";

export function PaneView({ viewModel, paneBoard, layoutVariant = "ghost", onSessionSelect, onNewPane }: { viewModel: PaneViewModel; paneBoard: PaneBoardViewModel; layoutVariant?: PaneLayoutOverlayVariant; onSessionSelect?: () => void; onNewPane?: () => void }) {
  const windowMapSurfaceRef = useWindowMapGesture(paneBoard.open);
  const selectedPane = paneBoard.panes.find((pane) => pane.tmuxPaneId === viewModel.target);
  const title = selectedPane?.name ?? viewModel.target;
  const agentName = selectedPane?.agentId ?? (selectedPane?.kind === "shell" ? "shell" : "agent");
  const sessionName = selectedPane?.sessionName ?? "mobile-agent";
  const cwd = selectedPane?.cwd ?? "~/work/mobile-agent";
  const shellMode = selectedPane?.kind === "shell";
  const waitingCount = paneBoard.panes.filter((pane) => pane.state === "waiting_input" || pane.state === "waiting_approval").length;

  return (
    <main ref={windowMapSurfaceRef} className="app-shell app-shell-terminal">
      <header className="app-topbar">
        <div className="app-topbar-leading">
          {onSessionSelect ? <button className="session-return-button" type="button" onClick={onSessionSelect} aria-label="Back to session selection" title="Back to session selection"><AppIcon name="arrow-left" size={16} /><span>Sessions</span></button> : null}
          <div className="brand-lockup">
            <span className="brand-mark">⌁</span>
            <span className="brand-name">agent<span className="brand-dot">.</span></span>
            <span className="brand-context">control room</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="connection-pill">
            <span className={`connection-dot connection-dot-${viewModel.status}`} />
            <span>{viewModel.status === "connected" ? "Tailnet connected" : viewModel.status}</span>
          </div>
          <button className="topbar-icon" type="button" aria-label="Settings" title="Settings"><AppIcon name="settings" size={17} /></button>
          <span className="profile-chip">TY</span>
        </div>
      </header>

      <div className="app-content">
        <aside className="context-rail">
          <div className="rail-block">
            <div className="section-kicker">WORKSPACE</div>
            <div className="workspace-card">
              <span className="workspace-icon"><AppIcon name="folder" size={17} /></span>
              <span className="workspace-copy">
                <strong>{sessionName}</strong>
                <small>{cwd}</small>
              </span>
              <span className="workspace-live" />
            </div>
          </div>

          <div className="rail-block rail-attention">
            <div className="rail-block-heading"><span className="section-kicker">ATTENTION</span><span className="attention-count">{waitingCount}</span></div>
            <div className="attention-copy">
              <span className="attention-icon">!</span>
              <span><strong>{waitingCount ? "Agents need you" : "All caught up"}</strong><small>{waitingCount ? "Input or approval is waiting" : "No pending actions"}</small></span>
            </div>
          </div>

          <div className="rail-spacer" />
          <div className="rail-block rail-note">
            <div className="section-kicker">SESSION MODE</div>
            <div className="mode-row"><span className="mode-icon">◉</span><span>Shared tmux viewport</span></div>
            <p>Mobile owns the viewport while you are here. PC activity hands it back automatically.</p>
          </div>
          <div className="rail-footer"><span className="sync-dot" /> agentd <span>v0.1</span></div>
        </aside>

        <section className="workspace-view">
          <div className="workspace-heading">
            <div className="heading-copy">
              <div className="section-kicker"><span className="live-mark" /> LIVE SESSION</div>
              <h1>{title}</h1>
              <div className="session-meta">
                <span className={`agent-badge agent-badge-${selectedPane?.kind ?? "agent"}`}>{agentName}</span>
                <span>{cwd}</span>
                <span className="meta-separator">·</span>
                <span>{viewModel.target}</span>
              </div>
            </div>
            <div className="heading-status">
              <div className={`owner-pill owner-pill-${viewModel.viewportOwner}`}>
                <span className="owner-pulse" />
                {viewModel.viewportOwner === "mobile" ? "You have control" : "PC has control"}
              </div>
              <span className="last-seen">live / just now</span>
            </div>
          </div>

          <section className="terminal-card" aria-label={`${viewModel.target} terminal`}>
            <div className="terminal-toolbar">
              {onSessionSelect ? <button className="terminal-action terminal-session-return" type="button" onClick={onSessionSelect} aria-label="Back to session selection" title="Back to session selection"><AppIcon name="arrow-left" size={15} /></button> : null}
              <div className="terminal-location">
                <span className={`terminal-status-dot terminal-status-dot-${viewModel.status}`} />
                <span className="terminal-shell-icon"><AppIcon name="terminal" size={15} /></span>
                <strong className="terminal-primary">{shellMode ? "zsh" : agentName}</strong>
                <span className="terminal-slash">·</span>
                <span className="terminal-session">{sessionName}</span>
                <span className="terminal-cwd">{cwd}</span>
              </div>
              <div className="terminal-toolbar-actions"><span className="terminal-pane-id">{viewModel.target}</span><span className="terminal-size">80 × 24</span>{onNewPane ? <button className="terminal-action terminal-new-pane-action" type="button" onClick={onNewPane} aria-label="Open a new pane" title="Open a new pane"><AppIcon name="new-pane" size={16} /></button> : null}<button className="terminal-action terminal-layout-action" type="button" onClick={paneBoard.toggle} aria-expanded={paneBoard.isOpen} aria-controls="tmux-window-map" aria-label={paneBoard.isOpen ? "Close tmux window map" : "Open tmux window map"} title={paneBoard.isOpen ? "Close window map" : "Open window map"}><AppIcon name="layout" size={16} /></button></div>
            </div>
            <div ref={viewModel.terminalContainerRef} className="terminal-container" />
            <div className="terminal-statusbar">
              <span><span className="statusbar-led" /> {viewModel.status === "connected" ? "streaming" : viewModel.status}</span>
              <span>{viewModel.viewportReason ? `viewport · ${viewModel.viewportReason}` : "xterm / tmux"}</span>
              <span>UTF-8</span>
            </div>
          </section>

          {viewModel.errorMessage ? (
            <div className="message-card message-card-error" role="alert">
              <span><strong>Connection interrupted</strong><small>{viewModel.errorMessage}</small></span>
              <button className="small-button" type="button" onClick={viewModel.reconnect}>Reconnect</button>
            </div>
          ) : null}
          {viewModel.viewportOwner === "desktop" && viewModel.status === "connected" ? (
            <div className="message-card message-card-warning" role="status">
              <span><strong>PC activity detected</strong><small>The viewport is back at desktop size.</small></span>
              <button className="small-button small-button-dark" type="button" onClick={viewModel.claim}>Take control</button>
            </div>
          ) : null}
        </section>

        <aside className="command-deck">
            <PaneBoardView viewModel={paneBoard} alwaysOpen showLayout={paneBoard.isOpen} layoutVariant={layoutVariant} />
        </aside>
      </div>
    </main>
  );
}
