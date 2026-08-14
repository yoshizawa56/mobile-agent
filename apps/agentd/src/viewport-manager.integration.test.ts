import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  hasObserved,
  runScenarioTable,
  type FixtureHandle,
  type ScenarioCase,
  type ScenarioTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { spawnPty, type PtyProcess } from "./pty.js";
import { TmuxAdapter } from "./tmux.js";
import { TmuxViewportManager } from "./viewport-manager.js";

const canUseRealTmux = probeIsolatedTmux();
type IntegrationStep = { type: "run" };
type IntegrationFixture = {
  tmux: RealTmuxFixture;
  pty?: PtyProcess;
  manager?: TmuxViewportManager;
  selectedPaneId?: string;
  stagedZoomed: boolean;
  stagedSelected: boolean;
  stagedVisible: boolean;
  finalZoomed: boolean;
  finalSelected: boolean;
  finalVisible: boolean;
  clientSelected: boolean;
  outputHasErase: boolean;
  afterSplitZoomed: boolean;
  afterSplitSelected: boolean;
  afterSplitVisible: boolean;
  output: string;
};
type IntegrationContext = Omit<IntegrationFixture, "tmux" | "pty" | "manager" | "selectedPaneId" | "output">;

const integrationFixture = (): FixtureHandle<IntegrationFixture> => {
  const tmux = new RealTmuxFixture();
  const fixture: IntegrationFixture = { tmux, stagedZoomed: false, stagedSelected: false, stagedVisible: false, finalZoomed: false, finalSelected: false, finalVisible: false, clientSelected: false, outputHasErase: false, afterSplitZoomed: false, afterSplitSelected: false, afterSplitVisible: false, output: "" };
  return {
    fixture,
    cleanup: () => {
      fixture.pty?.kill();
      fixture.manager?.dispose();
      fixture.tmux.dispose();
    },
  };
};

const cases = [
  { name: "attaches a selected split pane as one fully redrawn viewport", steps: [{ type: "run" }], assert: [hasObserved<IntegrationContext, undefined>("stagedZoomed", true), hasObserved<IntegrationContext, undefined>("stagedSelected", true), hasObserved<IntegrationContext, undefined>("stagedVisible", true), hasObserved<IntegrationContext, undefined>("finalZoomed", true), hasObserved<IntegrationContext, undefined>("finalSelected", true), hasObserved<IntegrationContext, undefined>("finalVisible", true), hasObserved<IntegrationContext, undefined>("clientSelected", true), hasObserved<IntegrationContext, undefined>("outputHasErase", true), hasObserved<IntegrationContext, undefined>("afterSplitZoomed", true), hasObserved<IntegrationContext, undefined>("afterSplitSelected", true), hasObserved<IntegrationContext, undefined>("afterSplitVisible", true)] },
] satisfies readonly ScenarioCase<"default", IntegrationStep, undefined, IntegrationContext>[];

const table: ScenarioTable<IntegrationFixture, "default", IntegrationStep, undefined, IntegrationContext> = {
  defaultFixture: integrationFixture,
  cases,
  execute: async (fixture, steps) => {
    for (const step of steps) {
      if (step.type !== "run") continue;
      fixture.selectedPaneId = fixture.tmux.createSplitWindow();
      fixture.manager = new TmuxViewportManager(fixture.tmux.adapter);
      const prepared = fixture.manager.prepare(fixture.selectedPaneId, "/tmp", 80, 24);
      const staged = fixture.tmux.adapter.snapshotWindow(prepared.pane);
      fixture.stagedZoomed = staged.zoomed;
      fixture.stagedSelected = staged.activePaneId === fixture.selectedPaneId;
      fixture.stagedVisible = !staged.visibleLayout.includes("{");
      fixture.pty = spawnPty("tmux", fixture.tmux.adapter.attachArgs(prepared.pane.paneId), { name: "xterm-256color", cols: 80, rows: 24, cwd: "/tmp", env: { ...process.env, TERM: "xterm-256color" } });
      fixture.pty.onData((data) => { fixture.output += data; });
      const lease = await prepared.attach({ ptyPid: fixture.pty.pid, cols: 80, rows: 24, onEvent: () => undefined });
      await delay(100);
      const final = fixture.tmux.adapter.snapshotWindow(prepared.pane);
      const client = fixture.tmux.adapter.findClientByPid(fixture.pty.pid);
      fixture.finalZoomed = final.zoomed;
      fixture.finalSelected = final.activePaneId === fixture.selectedPaneId;
      fixture.finalVisible = !final.visibleLayout.includes("{");
      fixture.clientSelected = client?.paneId === fixture.selectedPaneId;
      fixture.outputHasErase = fixture.output.includes("\u001b[K");
      fixture.tmux.adapter.splitWindow("/tmp", undefined, "right", fixture.selectedPaneId, true);
      fixture.manager.reassertMobileViewport(fixture.selectedPaneId);
      await delay(100);
      const afterSplit = fixture.tmux.adapter.snapshotWindow(prepared.pane);
      fixture.afterSplitZoomed = afterSplit.zoomed;
      fixture.afterSplitSelected = afterSplit.activePaneId === fixture.selectedPaneId;
      fixture.afterSplitVisible = !afterSplit.visibleLayout.includes("{");
      lease.release();
    }
  },
  observe: (fixture) => ({ stagedZoomed: fixture.stagedZoomed, stagedSelected: fixture.stagedSelected, stagedVisible: fixture.stagedVisible, finalZoomed: fixture.finalZoomed, finalSelected: fixture.finalSelected, finalVisible: fixture.finalVisible, clientSelected: fixture.clientSelected, outputHasErase: fixture.outputHasErase, afterSplitZoomed: fixture.afterSplitZoomed, afterSplitSelected: fixture.afterSplitSelected, afterSplitVisible: fixture.afterSplitVisible }),
};

describe.skipIf(!canUseRealTmux)("real tmux mobile viewport fixture", () => {
  runScenarioTable(it as unknown as TestRegistrar, table);
});

class RealTmuxFixture {
  public readonly directory = mkdtempSync(join(tmpdir(), "mobile-agent-tmux-"));
  public readonly socketPath = join(this.directory, "server.sock");
  public readonly adapter = new TmuxAdapter(this.socketPath, "/dev/null");
  public constructor() { this.require(["new-session", "-d", "-s", "issue11", "-x", "120", "-y", "40", "-c", "/tmp"]); }
  public createSplitWindow(): string { const original = this.adapter.resolvePane("issue11:0.0"); const split = this.adapter.splitWindow("/tmp", undefined, "right", original.paneId); this.require(["send-keys", "-t", original.paneId, "printf LEFT_LAYOUT", "Enter"]); this.require(["send-keys", "-t", split, "printf SELECTED_PANE", "Enter"]); return split; }
  public dispose(): void { try { this.adapter.require(["kill-server"]); } catch { /* tmux may already be gone */ } rmSync(this.directory, { recursive: true, force: true }); }
  private require(args: string[]): void { this.adapter.require(args); }
}

function probeIsolatedTmux(): boolean {
  const directory = mkdtempSync(join(tmpdir(), "mobile-agent-tmux-probe-"));
  const socketPath = join(directory, "server.sock");
  try {
    const result = spawnSync("tmux", ["-f", "/dev/null", "-S", socketPath, "new-session", "-d", "-s", "probe", "-c", "/tmp"], { stdio: "ignore" });
    if (result.status !== 0 || !existsSync(socketPath)) return false;
    spawnSync("tmux", ["-f", "/dev/null", "-S", socketPath, "kill-server"], { stdio: "ignore" });
    return true;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
