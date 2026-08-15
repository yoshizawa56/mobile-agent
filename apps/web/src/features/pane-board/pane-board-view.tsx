import { AppIcon } from "../../app-icon";
import type { PaneBoardViewModel } from "./pane-board-viewmodel";
import { paneStateLabel } from "./pane-board-viewmodel";
import { PaneLayoutOverlay, type PaneLayoutOverlayVariant } from "./pane-layout-overlay-view";

export function PaneBoardView({ viewModel, alwaysOpen = false, showLayout = false, layoutVariant = "ghost" }: { viewModel: PaneBoardViewModel; alwaysOpen?: boolean; showLayout?: boolean; layoutVariant?: PaneLayoutOverlayVariant }) {
  const waitingCount = viewModel.panes.filter((pane) => pane.state === "waiting_input" || pane.state === "waiting_approval").length;

  return (
    <div className={`pane-board-shell${alwaysOpen ? " pane-board-shell-always" : ""}`}>
      <button className={`pane-picker-button${viewModel.isOpen ? " pane-picker-button-open" : ""}`} type="button" onClick={viewModel.toggle} aria-expanded={viewModel.isOpen} aria-controls="tmux-window-map">
        <span className="button-glyph"><AppIcon name="layout" size={15} /></span>
        <span>All panes</span>
        <span className="button-count">{viewModel.panes.length || "—"}</span>
      </button>
      <aside className={`pane-board${alwaysOpen ? " pane-board-desktop" : ""}${showLayout ? " pane-board-layout" : ""}`} data-open={viewModel.isOpen} aria-label="tmux panes">
        {showLayout ? (
          <PaneLayoutOverlay id="tmux-window-map" panes={viewModel.panes} selectedTarget={viewModel.selectedTarget} onSelect={viewModel.select} onClose={viewModel.close} variant={layoutVariant} />
        ) : null}
        {!showLayout ? (
          <>
        <div className="pane-board-header">
          <div>
            <div className="section-kicker"><span className="live-mark" /> WORKSPACE</div>
            <h2>Command deck</h2>
          </div>
          <div className="board-actions">
            <span className="board-count">{waitingCount ? `${waitingCount} needs you` : "All clear"}</span>
            <button className="icon-button" type="button" onClick={viewModel.refresh} aria-label="Refresh panes" title="Refresh panes"><AppIcon name="refresh" size={15} /></button>
            <button className="icon-button board-close" type="button" onClick={viewModel.close} aria-label="Close pane list"><AppIcon name="close" size={15} /></button>
          </div>
        </div>
        <div className="board-divider" />
        {viewModel.status === "loading" ? <p className="pane-picker-message">Reading tmux…</p> : null}
        {viewModel.status === "error" ? (
          <div className="pane-picker-message error-text">
            <p>{viewModel.errorMessage}</p>
            <button className="text-button" type="button" onClick={viewModel.refresh}>Try again</button>
          </div>
        ) : null}
        {viewModel.status === "ready" && viewModel.panes.length === 0 ? (
          <p className="pane-picker-message">No tmux panes found.</p>
        ) : null}
        <div className="pane-list">
          {viewModel.panes.map((pane) => {
            const selected = pane.tmuxPaneId === viewModel.selectedTarget;
            const needsAttention = pane.state === "waiting_input" || pane.state === "waiting_approval";
            return (
              <button className={`pane-list-item${selected ? " pane-list-item-selected" : ""}`} type="button" key={pane.id} onClick={() => viewModel.select(pane)}>
                <span className={`pane-avatar pane-avatar-${pane.kind}`}>
                  {pane.kind === "shell" ? <AppIcon name="terminal" size={15} /> : (pane.agentId?.slice(0, 1) ?? "·").toUpperCase()}
                </span>
                <span className="pane-list-main">
                  <span className="pane-list-title"><strong>{pane.name}</strong><span className="pane-index-label">PANE {pane.paneIndex ?? "?"}</span>{selected ? <span className="selected-label">OPEN</span> : null}</span>
                  <small>{pane.agentId ?? pane.title ?? "shell"} <span>·</span> {pane.cwd}</small>
                </span>
                <span className={`pane-state pane-state-${pane.state}${needsAttention ? " pane-state-attention" : ""}`}>
                  <span className="pane-state-dot" />
                  {paneStateLabel(pane.state)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="board-footer">
          <span><kbd>⌘</kbd><kbd>K</kbd> quick switch</span>
          <span className="sync-label"><span className="sync-dot" /> synced</span>
        </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
