import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnPty, type PtyProcess } from "./pty.js";
import { TmuxAdapter } from "./tmux.js";
import { TmuxViewportManager } from "./viewport-manager.js";

const canUseRealTmux = probeIsolatedTmux();

describe.skipIf(!canUseRealTmux)("real tmux mobile viewport fixture", () => {
  it("attaches a selected split pane as one fully redrawn viewport", async () => {
    const fixture = new RealTmuxFixture();
    let pty: PtyProcess | undefined;
    let manager: TmuxViewportManager | undefined;

    try {
      const selectedPaneId = fixture.createSplitWindow();
      manager = new TmuxViewportManager(fixture.adapter);
      const prepared = manager.prepare(selectedPaneId, "/tmp", 80, 24);

      // This is the regression boundary: the shared window must already be
      // zoomed before attach-session can emit its first PTY frame.
      const staged = fixture.adapter.snapshotWindow(prepared.pane);
      expect(staged.zoomed).toBe(true);
      expect(staged.activePaneId).toBe(selectedPaneId);
      expect(staged.visibleLayout).not.toContain("{");

      pty = spawnPty("tmux", fixture.adapter.attachArgs(prepared.pane.paneId), {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: "/tmp",
        env: { ...process.env, TERM: "xterm-256color" },
      });
      let output = "";
      pty.onData((data) => {
        output += data;
      });

      const lease = await prepared.attach({
        ptyPid: pty.pid,
        cols: 80,
        rows: 24,
        onEvent: () => undefined,
      });
      await delay(100);

      const final = fixture.adapter.snapshotWindow(prepared.pane);
      const client = fixture.adapter.findClientByPid(pty.pid);
      expect(final.zoomed).toBe(true);
      expect(final.activePaneId).toBe(selectedPaneId);
      expect(final.visibleLayout).not.toContain("{");
      expect(client?.paneId).toBe(selectedPaneId);
      // refresh-client -rS emits line erases even when tmux believes the
      // screen is already clean; this prevents stale cells in xterm.js.
      expect(output).toContain("\u001b[K");

      fixture.adapter.splitWindow("/tmp", undefined, "right", selectedPaneId, true);
      manager.reassertMobileViewport(selectedPaneId);
      await delay(100);
      const afterSplit = fixture.adapter.snapshotWindow(prepared.pane);
      expect(afterSplit.zoomed).toBe(true);
      expect(afterSplit.activePaneId).toBe(selectedPaneId);
      expect(afterSplit.visibleLayout).not.toContain("{");

      lease.release();
    } finally {
      pty?.kill();
      manager?.dispose();
      fixture.dispose();
    }
  });
});

class RealTmuxFixture {
  public readonly directory = mkdtempSync(join(tmpdir(), "mobile-agent-tmux-"));
  public readonly socketPath = join(this.directory, "server.sock");
  public readonly adapter = new TmuxAdapter(this.socketPath, "/dev/null");

  public constructor() {
    this.require(["new-session", "-d", "-s", "issue11", "-x", "120", "-y", "40", "-c", "/tmp"]);
  }

  public createSplitWindow(): string {
    const original = this.adapter.resolvePane("issue11:0.0");
    const split = this.adapter.splitWindow("/tmp", undefined, "right", original.paneId);
    this.require(["send-keys", "-t", original.paneId, "printf LEFT_LAYOUT", "Enter"]);
    this.require(["send-keys", "-t", split, "printf SELECTED_PANE", "Enter"]);
    return split;
  }

  public dispose(): void {
    try {
      this.adapter.require(["kill-server"]);
    } catch {
      // The PTY or the test may already have stopped the isolated server.
    }
    rmSync(this.directory, { recursive: true, force: true });
  }

  private require(args: string[]): void {
    this.adapter.require(args);
  }
}

function probeIsolatedTmux(): boolean {
  const directory = mkdtempSync(join(tmpdir(), "mobile-agent-tmux-probe-"));
  const socketPath = join(directory, "server.sock");
  try {
    const result = spawnSync(
      "tmux",
      ["-f", "/dev/null", "-S", socketPath, "new-session", "-d", "-s", "probe", "-c", "/tmp"],
      { stdio: "ignore" },
    );
    if (result.status !== 0 || !existsSync(socketPath)) return false;
    spawnSync("tmux", ["-f", "/dev/null", "-S", socketPath, "kill-server"], { stdio: "ignore" });
    return true;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
