import { describe, expect, it } from "vitest";
import type { TmuxLiveSnapshot, TmuxPane } from "./tmux.js";
import { TmuxStateMonitor } from "./tmux-state.js";

type TestContext = {
  panes: TmuxPane[];
  changes: Array<{ sessionName: string; reason: string }>;
  monitor?: TmuxStateMonitor;
};

const cases = [
  {
    name: "reports a pane created after the initial snapshot",
    mutate: (ctx: TestContext) => ctx.panes.push(createPane("%2", "work")),
    expected: [{ sessionName: "work", reason: "pane_created" }],
  },
  {
    name: "reports a pane deleted after the initial snapshot",
    mutate: (ctx: TestContext) => { ctx.panes = []; },
    expected: [{ sessionName: "work", reason: "pane_deleted" }],
  },
  {
    name: "reports a changed pane without sending its contents",
    mutate: (ctx: TestContext) => { ctx.panes[0] = { ...ctx.panes[0]!, title: "changed" }; },
    expected: [{ sessionName: "work", reason: "pane_changed" }],
  },
];

describe("tmux state monitor", () => {
  it.each(cases)("$name", async ({ mutate, expected }) => {
    const ctx: TestContext = {
      panes: [createPane("%1", "work")],
      changes: [],
    };
    ctx.monitor = new TmuxStateMonitor({
      readPanes: () => liveSnapshot(ctx.panes),
      synchronize: async (snapshot) => snapshot.panes.map((pane) => pane.paneId),
      onChange: (changes) => ctx.changes.push(...changes),
    });

    await ctx.monitor.reconcile();
    mutate(ctx);
    await ctx.monitor.reconcile();

    expect(ctx.changes).toEqual(expected);
  });

  it("coalesces multiple pane changes in one session", async () => {
    const ctx: TestContext = {
      panes: [createPane("%1", "work")],
      changes: [],
    };
    const monitor = new TmuxStateMonitor({
      readPanes: () => liveSnapshot(ctx.panes),
      synchronize: async (snapshot) => snapshot.panes.map((pane) => pane.paneId),
      onChange: (changes) => ctx.changes.push(...changes),
    });

    await monitor.reconcile();
    ctx.panes.push(createPane("%2", "work"), createPane("%3", "work"));
    await monitor.reconcile();

    expect(ctx.changes).toEqual([{ sessionName: "work", reason: "pane_created" }]);
  });

  it("cleans stale records on a slower cadence", async () => {
    const ctx: TestContext = {
      panes: [createPane("%1", "work")],
      changes: [],
    };
    let now = 1_000;
    const cleanups: Array<{ ids: string[]; olderThan: string }> = [];
    const monitor = new TmuxStateMonitor({
      readPanes: () => liveSnapshot(ctx.panes),
      synchronize: async (snapshot) => snapshot.panes.map((pane) => pane.paneId),
      cleanup: async (ids, olderThan) => { cleanups.push({ ids: [...ids], olderThan }); },
      onChange: (changes) => ctx.changes.push(...changes),
      cleanupIntervalMs: 1_000,
      paneRetentionMs: 10_000,
      now: () => now,
    });

    await monitor.reconcile();
    now += 999;
    await monitor.reconcile();
    now += 1;
    await monitor.reconcile();

    expect(cleanups).toEqual([
      { ids: ["%1"], olderThan: new Date(-9_000).toISOString() },
      { ids: ["%1"], olderThan: new Date(-8_000).toISOString() },
    ]);
  });

  it("does not clean while tmux is unavailable", async () => {
    const ctx: TestContext = {
      panes: [createPane("%1", "work")],
      changes: [],
    };
    let available = true;
    let cleanupCount = 0;
    const monitor = new TmuxStateMonitor({
      readPanes: () => available ? liveSnapshot(ctx.panes) : { panes: [], available: false, tmuxServerId: null, tmuxServerScope: null },
      synchronize: async (snapshot) => snapshot.panes.map((pane) => pane.paneId),
      cleanup: async () => { cleanupCount += 1; },
      onChange: (changes) => ctx.changes.push(...changes),
    });

    await monitor.reconcile();
    available = false;
    await monitor.reconcile();

    expect(cleanupCount).toBe(1);
    expect(ctx.changes).toEqual([]);
  });

  it("keeps reconciliation working when cleanup fails", async () => {
    const ctx: TestContext = {
      panes: [createPane("%1", "work")],
      changes: [],
    };
    const monitor = new TmuxStateMonitor({
      readPanes: () => liveSnapshot(ctx.panes),
      synchronize: async (snapshot) => snapshot.panes.map((pane) => pane.paneId),
      cleanup: async () => { throw new Error("database locked"); },
      onChange: (changes) => ctx.changes.push(...changes),
    });

    await monitor.reconcile();
    ctx.panes[0] = { ...ctx.panes[0]!, title: "changed" };
    await monitor.reconcile();

    expect(ctx.changes).toEqual([{ sessionName: "work", reason: "pane_changed" }]);
  });
});

function createPane(paneId: string, sessionName: string): TmuxPane {
  return {
    paneId,
    windowId: "@0",
    sessionName,
    tmuxServerId: "server-1",
    windowName: "shell",
    windowIndex: 0,
    cwd: "/tmp",
    command: "zsh",
    title: "zsh",
    active: true,
    left: 0,
    top: 0,
    width: 80,
    height: 24,
    windowWidth: 80,
    windowHeight: 24,
  };
}

function liveSnapshot(panes: TmuxPane[]): TmuxLiveSnapshot {
  return { panes, available: true, tmuxServerId: "server-1", tmuxServerScope: "scope-1" };
}
