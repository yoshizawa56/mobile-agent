import { describe, expect, it } from "vitest";
import {
  TmuxAdapter,
  type TmuxClient,
  type TmuxPaneRef,
  type TmuxWindowSize,
  type TmuxWindowSnapshot,
} from "./tmux.js";
import { TmuxViewportManager, type ViewportEvent } from "./viewport-manager.js";

type TestContext = {
  adapter?: FakeTmuxAdapter;
  manager?: TmuxViewportManager;
  lease?: Awaited<ReturnType<ReturnType<TmuxViewportManager["prepare"]>["attach"]>>;
  events: ViewportEvent[];
  error?: unknown;
};

type TableCase = {
  name: string;
  given: (ctx: TestContext) => void;
  when: (ctx: TestContext) => Promise<void>;
  check: Array<(ctx: TestContext) => void>;
  assert: Array<(ctx: TestContext) => void>;
};

const cases: TableCase[] = [
  {
    name: "enters a phone-sized zoomed viewport without changing the saved desktop pane",
    given: (ctx) => {
      ctx.adapter = new FakeTmuxAdapter();
      ctx.manager = new TmuxViewportManager(ctx.adapter);
    },
    when: async (ctx) => {
      const prepared = ctx.manager!.prepare("agentd", "/tmp");
      ctx.lease = await prepared.attach({
        ptyPid: 200,
        cols: 80,
        rows: 24,
        onEvent: (event) => ctx.events.push(event),
      });
    },
    check: [
      (ctx) => expect(ctx.adapter?.state.width).toBe(80),
      (ctx) => expect(ctx.adapter?.state.height).toBe(24),
      (ctx) => expect(ctx.adapter?.state.zoomed).toBe(true),
    ],
    assert: [
      (ctx) => expect(ctx.adapter?.state.activePaneId).toBe("%0"),
      (ctx) => expect(ctx.adapter?.desktop.flags).toContain("active-pane"),
      (ctx) => expect(ctx.events).toContainEqual({ owner: "mobile", reason: "attached" }),
    ],
  },
  {
    name: "returns to the desktop viewport when a desktop client becomes active",
    given: (ctx) => {
      ctx.adapter = new FakeTmuxAdapter();
      ctx.manager = new TmuxViewportManager(ctx.adapter);
    },
    when: async (ctx) => {
      const prepared = ctx.manager!.prepare("agentd", "/tmp");
      ctx.lease = await prepared.attach({
        ptyPid: 200,
        cols: 80,
        rows: 24,
        onEvent: (event) => ctx.events.push(event),
      });
      ctx.adapter!.desktop.activity += 1;
      ctx.manager!.handleTmuxHook("client-active", ctx.adapter!.desktop.name);
    },
    check: [
      (ctx) => expect(ctx.adapter?.state.width).toBe(120),
      (ctx) => expect(ctx.adapter?.state.height).toBe(40),
      (ctx) => expect(ctx.adapter?.state.zoomed).toBe(false),
    ],
    assert: [
      (ctx) => expect(ctx.adapter?.state.activePaneId).toBe("%1"),
      (ctx) => expect(ctx.adapter?.desktop.flags).toBe("attached,focused"),
      (ctx) => expect(ctx.events).toContainEqual({ owner: "desktop", reason: "desktop_activity" }),
    ],
  },
  {
    name: "restores the original layout when the phone disconnects first",
    given: (ctx) => {
      ctx.adapter = new FakeTmuxAdapter();
      ctx.manager = new TmuxViewportManager(ctx.adapter);
    },
    when: async (ctx) => {
      const prepared = ctx.manager!.prepare("agentd", "/tmp");
      ctx.lease = await prepared.attach({
        ptyPid: 200,
        cols: 80,
        rows: 24,
        onEvent: (event) => ctx.events.push(event),
      });
      ctx.lease.release();
    },
    check: [
      (ctx) => expect(ctx.adapter?.state.width).toBe(120),
      (ctx) => expect(ctx.adapter?.state.height).toBe(40),
      (ctx) => expect(ctx.adapter?.state.zoomed).toBe(false),
    ],
    assert: [
      (ctx) => expect(ctx.adapter?.state.activePaneId).toBe("%1"),
      (ctx) => expect(ctx.adapter?.desktop.flags).toBe("attached,focused"),
      (ctx) => expect(ctx.adapter?.state.windowSize).toBe("latest"),
      (ctx) => expect(ctx.events).toContainEqual({ owner: "desktop", reason: "detached" }),
    ],
  },
  {
    name: "does not restore a stale phone snapshot after desktop takeover",
    given: (ctx) => {
      ctx.adapter = new FakeTmuxAdapter();
      ctx.manager = new TmuxViewportManager(ctx.adapter);
    },
    when: async (ctx) => {
      const prepared = ctx.manager!.prepare("agentd", "/tmp");
      ctx.lease = await prepared.attach({
        ptyPid: 200,
        cols: 80,
        rows: 24,
        onEvent: (event) => ctx.events.push(event),
      });
      ctx.adapter!.desktop.width = 100;
      ctx.adapter!.desktop.height = 30;
      ctx.manager!.handleTmuxHook("client-resized", ctx.adapter!.desktop.name);
      ctx.lease.release();
    },
    check: [
      (ctx) => expect(ctx.adapter?.state.width).toBe(100),
      (ctx) => expect(ctx.adapter?.state.height).toBe(30),
    ],
    assert: [
      (ctx) => expect(ctx.adapter?.state.activePaneId).toBe("%1"),
      (ctx) => expect(ctx.adapter?.desktop.flags).toBe("attached,focused"),
      (ctx) => expect(ctx.adapter?.state.zoomed).toBe(false),
    ],
  },
];

describe("tmux viewport manager", () => {
  it.each(cases)("$name", async ({ given, when, check, assert }) => {
    const ctx: TestContext = { events: [] };
    given(ctx);
    try {
      await when(ctx);
    } catch (error) {
      ctx.error = error;
    }
    check.forEach((checkCase) => checkCase(ctx));
    assert.forEach((assertCase) => assertCase(ctx));
    ctx.manager?.dispose();
  });
});

class FakeTmuxAdapter extends TmuxAdapter {
  public readonly state = {
    width: 120,
    height: 40,
    zoomed: false,
    activePaneId: "%1",
    layout: "layout-120x40",
    windowSize: "latest" as TmuxWindowSize,
  };

  public readonly desktop: TmuxClient = {
    name: "/dev/desktop",
    pid: 100,
    tty: "/dev/desktop",
    sessionName: "agentd",
    windowId: "@0",
    paneId: "%1",
    width: 120,
    height: 40,
    flags: "attached,focused",
    activity: 1,
  };

  private readonly mobile: TmuxClient = {
    name: "/dev/mobile",
    pid: 200,
    tty: "/dev/mobile",
    sessionName: "agentd",
    windowId: "@0",
    paneId: "%0",
    width: 80,
    height: 24,
    flags: "attached,active-pane",
    activity: 2,
  };

  public constructor() {
    super("/private/tmp/mobile-agent-fake.sock");
  }

  public override resolvePane(_target: string): TmuxPaneRef {
    return { paneId: "%0", windowId: "@0", sessionName: "agentd" };
  }

  public override snapshotWindow(pane: TmuxPaneRef): TmuxWindowSnapshot {
    return {
      ...pane,
      layout: this.state.layout,
      visibleLayout: this.state.layout,
      zoomed: this.state.zoomed,
      activePaneId: this.state.activePaneId,
      width: this.state.width,
      height: this.state.height,
      windowSize: this.state.windowSize,
    };
  }

  public override findClientByPid(pid: number): TmuxClient | undefined {
    return pid === this.mobile.pid ? this.mobile : undefined;
  }

  public override listClients(): TmuxClient[] {
    return [this.mobile, this.desktop];
  }

  public override clientView(clientName: string): TmuxClient {
    if (clientName === this.mobile.name) return this.mobile;
    return this.desktop;
  }

  public override setWindowSize(_windowId: string, value: "largest" | "smallest" | "manual" | "latest"): void {
    this.state.windowSize = value;
  }

  public override resizeWindow(_windowId: string, width: number, height: number): void {
    this.state.width = width;
    this.state.height = height;
  }

  public override switchClient(_clientName: string, targetPane: string): void {
    this.state.activePaneId = targetPane;
  }

  public override setClientFlags(clientName: string, flags: string): void {
    if (clientName !== this.desktop.name) return;
    const current = new Set(this.desktop.flags.split(",").filter(Boolean));
    for (const flag of flags.split(",")) {
      if (flag.startsWith("!")) current.delete(flag.slice(1));
      else current.add(flag);
    }
    this.desktop.flags = [...current].join(",");
  }

  public override zoomPane(targetPane: string): void {
    this.state.zoomed = !this.state.zoomed;
    this.state.activePaneId = targetPane;
  }

  public override selectLayout(_windowId: string, layout: string): void {
    this.state.layout = layout;
    this.state.zoomed = false;
  }

  public override selectPane(paneId: string): void {
    this.state.activePaneId = paneId;
  }

  public override restoreSnapshot(snapshot: TmuxWindowSnapshot): void {
    this.state.layout = snapshot.layout;
    this.state.width = snapshot.width;
    this.state.height = snapshot.height;
    this.state.zoomed = snapshot.zoomed;
    this.state.activePaneId = snapshot.activePaneId;
    this.state.windowSize = snapshot.windowSize;
  }
}
