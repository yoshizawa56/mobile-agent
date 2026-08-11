import { describe, expect, it } from "vitest";
import type { TmuxPane } from "./tmux.js";
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
      readPanes: () => ctx.panes,
      synchronize: async () => undefined,
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
      readPanes: () => ctx.panes,
      synchronize: async () => undefined,
      onChange: (changes) => ctx.changes.push(...changes),
    });

    await monitor.reconcile();
    ctx.panes.push(createPane("%2", "work"), createPane("%3", "work"));
    await monitor.reconcile();

    expect(ctx.changes).toEqual([{ sessionName: "work", reason: "pane_created" }]);
  });
});

function createPane(paneId: string, sessionName: string): TmuxPane {
  return {
    paneId,
    windowId: "@0",
    sessionName,
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
