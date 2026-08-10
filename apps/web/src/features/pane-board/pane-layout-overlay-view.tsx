import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PaneSummary } from "@mobile-agent/protocol";
import { paneStateLabel } from "./pane-board-viewmodel";

export type PaneLayoutOverlayVariant = "ghost";

export function PaneLayoutOverlay({
  panes,
  selectedTarget,
  onSelect,
  onClose,
  variant = "ghost",
}: {
  panes: PaneSummary[];
  selectedTarget: string;
  onSelect: (pane: PaneSummary) => void;
  onClose?: () => void;
  variant?: PaneLayoutOverlayVariant;
}) {
  const windows = useMemo(() => groupByWindow(panes), [panes]);
  const selectedPane = panes.find((pane) => pane.tmuxPaneId === selectedTarget);
  const [activeWindowId, setActiveWindowId] = useState(selectedPane?.windowId ?? windows[0]?.id ?? "");
  const activeWindow = windows.find((window) => window.id === activeWindowId) ?? windows[0];

  useEffect(() => {
    if (selectedPane && selectedPane.windowId !== activeWindowId) setActiveWindowId(selectedPane.windowId);
  }, [activeWindowId, selectedPane]);

  return (
    <section className={`pane-layout-overlay pane-layout-overlay-${variant}`} aria-label="tmux window layout">
      <div className="layout-overlay-header">
        <div className="layout-overlay-title-group">
          <span className="section-kicker"><span className="live-mark" /> WINDOW MAP</span>
          <strong>{activeWindow ? `${activeWindow.sessionName} · ${activeWindow.name || `window ${activeWindow.index}`}` : "No tmux window"}</strong>
        </div>
        <div className="layout-overlay-actions">
          <span className="layout-preview-count">{windows.length} windows</span>
          {onClose ? <button className="layout-close-button" type="button" onClick={onClose} aria-label="Close window map">×</button> : null}
        </div>
      </div>

      <div className="window-tabs" role="tablist" aria-label="tmux windows">
        {windows.map((window) => {
          const attention = window.panes.some((pane) => pane.state === "waiting_input" || pane.state === "waiting_approval");
          const selected = window.id === activeWindow?.id;
          return (
            <button
              className={`window-tab${selected ? " window-tab-selected" : ""}`}
              key={window.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveWindowId(window.id)}
            >
              <span className={`window-tab-dot${attention ? " window-tab-dot-attention" : ""}`} />
              <span className="window-tab-label">{window.sessionName}</span>
              <span className="window-tab-number">{windowNumber(window.id)}</span>
            </button>
          );
        })}
      </div>

      {activeWindow ? (
        <div className="tmux-window-canvas" role="tabpanel" aria-label={`${activeWindow.sessionName} window ${windowNumber(activeWindow.id)}`}>
          <div className="tmux-window-chrome">
            <span className="tmux-window-chrome-title">{activeWindow.sessionName}</span>
            <span>window {windowNumber(activeWindow.id)}</span>
            <span>{activeWindow.panes.length} panes</span>
          </div>
        <div className={`tmux-window-panes${activeWindow.hasGeometry ? " tmux-window-panes-real" : ` tmux-window-panes-${Math.min(activeWindow.panes.length, 3)}`}`}>
            {activeWindow.panes.map((pane) => (
              <button
                className={`tmux-layout-pane${activeWindow.hasGeometry ? " tmux-layout-pane-real" : ""}${pane.tmuxPaneId === selectedTarget ? " tmux-layout-pane-selected" : ""}`}
                key={pane.id}
                type="button"
                onClick={() => onSelect(pane)}
                aria-label={`Select ${pane.name}`}
                style={activeWindow.hasGeometry ? paneGeometryStyle(pane, activeWindow) : undefined}
              >
                <span className="tmux-layout-pane-id">{pane.tmuxPaneId}</span>
                <strong>{pane.name}</strong>
                <small>{pane.agentId ?? "zsh"} · {paneStateLabel(pane.state)}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="pane-picker-message">No tmux windows found.</p>
      )}

      <div className="layout-overlay-footer">
        <span>tap a pane to open</span>
        <span>⌁ live tmux layout</span>
      </div>
    </section>
  );
}

function windowNumber(id: string): string {
  return id.replace(/^@/, "");
}

function groupByWindow(panes: PaneSummary[]): Array<{
  id: string;
  sessionName: string;
  name: string;
  index: number;
  windowWidth?: number;
  windowHeight?: number;
  hasGeometry: boolean;
  panes: PaneSummary[];
}> {
  const windows = new Map<string, {
    id: string;
    sessionName: string;
    name: string;
    index: number;
    windowWidth?: number;
    windowHeight?: number;
    hasGeometry: boolean;
    panes: PaneSummary[];
  }>();
  for (const pane of panes) {
    const current = windows.get(pane.windowId) ?? {
      id: pane.windowId,
      sessionName: pane.sessionName,
      name: pane.windowName ?? "",
      index: pane.windowIndex ?? (Number(windowNumber(pane.windowId)) || 0),
      windowWidth: pane.windowWidth,
      windowHeight: pane.windowHeight,
      hasGeometry: true,
      panes: [],
    };
    current.hasGeometry = current.hasGeometry && hasPaneGeometry(pane);
    current.windowWidth ??= pane.windowWidth;
    current.windowHeight ??= pane.windowHeight;
    current.panes.push(pane);
    windows.set(pane.windowId, current);
  }
  return [...windows.values()];
}

function hasPaneGeometry(pane: PaneSummary): boolean {
  return [pane.left, pane.top, pane.width, pane.height, pane.windowWidth, pane.windowHeight]
    .every((value) => typeof value === "number" && value > 0);
}

function paneGeometryStyle(
  pane: PaneSummary,
  window: { windowWidth?: number; windowHeight?: number },
): CSSProperties | undefined {
  if (!hasPaneGeometry(pane) || !window.windowWidth || !window.windowHeight) return undefined;
  return {
    left: `${(pane.left! / window.windowWidth) * 100}%`,
    top: `${(pane.top! / window.windowHeight) * 100}%`,
    width: `${(pane.width! / window.windowWidth) * 100}%`,
    height: `${(pane.height! / window.windowHeight) * 100}%`,
  };
}
