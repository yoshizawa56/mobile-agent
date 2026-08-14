import type { TmuxPane } from "./tmux.js";

export type TmuxPaneChangeReason = "pane_created" | "pane_deleted" | "pane_changed";

export type TmuxPaneChange = {
  sessionName: string;
  reason: TmuxPaneChangeReason;
};

export type TmuxStateMonitorOptions = {
  readPanes: () => TmuxPane[];
  synchronize: (panes: TmuxPane[]) => Promise<void>;
  onChange: (changes: TmuxPaneChange[]) => void;
  intervalMs?: number;
};

/**
 * Polls tmux as the live source of truth and reports coalesced changes.
 *
 * Polling is intentionally used as the first implementation. It sees panes
 * created by either agentd or an arbitrary desktop tmux client and does not
 * depend on every tmux hook being installed or delivered.
 */
export class TmuxStateMonitor {
  private readonly intervalMs: number;
  private previous = new Map<string, PaneSnapshot>();
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private initialized = false;

  public constructor(private readonly options: TmuxStateMonitorOptions) {
    this.intervalMs = options.intervalMs ?? 1_000;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reconcile();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.reconcile();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public async reconcile(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const panes = this.options.readPanes();
      await this.options.synchronize(panes);
      const current = snapshot(panes);
      if (!this.initialized) {
        this.previous = current;
        this.initialized = true;
        return;
      }
      const changes = diff(this.previous, current, panes);
      this.previous = current;
      if (changes.length) this.options.onChange(changes);
    } catch {
      // A tmux server can disappear between reads. Keep the previous snapshot
      // so a later successful read can still produce the appropriate change.
    } finally {
      this.busy = false;
    }
  }
}

type PaneSnapshot = {
  sessionName: string;
  fingerprint: string;
};

function snapshot(panes: TmuxPane[]): Map<string, PaneSnapshot> {
  return new Map(panes.map((pane) => [pane.paneId, { sessionName: pane.sessionName, fingerprint: paneFingerprint(pane) }]));
}

function paneFingerprint(pane: TmuxPane): string {
  return JSON.stringify([
    pane.sessionName,
    pane.windowId,
    pane.windowName,
    pane.windowIndex,
    pane.paneIndex,
    pane.cwd,
    pane.command,
    pane.title,
    pane.active,
    pane.left,
    pane.top,
    pane.width,
    pane.height,
    pane.windowWidth,
    pane.windowHeight,
    pane.agentdPaneId,
    pane.agentdName,
    pane.agentdKind,
    pane.agentdAgentId,
    pane.agentdRunId,
    pane.agentdManagedSessionId,
    pane.agentdParentRunId,
  ]);
}

function diff(previous: Map<string, PaneSnapshot>, current: Map<string, PaneSnapshot>, panes: TmuxPane[]): TmuxPaneChange[] {
  const currentById = new Map(panes.map((pane) => [pane.paneId, pane]));
  const changes = new Map<string, TmuxPaneChange>();

  for (const [paneId, snapshot] of current) {
    const prior = previous.get(paneId);
    if (prior === undefined) {
      const pane = currentById.get(paneId);
      if (pane) changes.set(pane.sessionName, { sessionName: pane.sessionName, reason: "pane_created" });
    } else if (prior.fingerprint !== snapshot.fingerprint) {
      const pane = currentById.get(paneId);
      if (pane) {
        changes.set(pane.sessionName, { sessionName: pane.sessionName, reason: "pane_changed" });
        if (prior.sessionName !== pane.sessionName) {
          changes.set(prior.sessionName, { sessionName: prior.sessionName, reason: "pane_changed" });
        }
      }
    }
  }

  for (const [paneId, prior] of previous) {
    if (current.has(paneId)) continue;
    changes.set(prior.sessionName, { sessionName: prior.sessionName, reason: "pane_deleted" });
  }

  return [...changes.values()];
}
