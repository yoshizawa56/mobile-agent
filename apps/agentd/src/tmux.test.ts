import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TmuxAdapter } from "./tmux.js";

describe("tmux adapter split behavior", () => {
  it.each([
    { name: "keeps a zoomed window zoomed", keepZoomed: true, includesZoomFlag: true },
    { name: "does not zoom an ordinary desktop split", keepZoomed: false, includesZoomFlag: false },
  ])("$name", ({ keepZoomed, includesZoomFlag }) => {
    const adapter = new RecordingTmuxAdapter();
    adapter.splitWindow("/tmp", undefined, "right", "%1", keepZoomed);

    expect(adapter.lastArgs.includes("-Z")).toBe(includesZoomFlag);
  });
});

describe("tmux adapter client switching", () => {
  it.each([
    { name: "keeps a zoomed window zoomed", keepZoomed: true, includesZoomFlag: true },
    { name: "uses the ordinary client switch by default", keepZoomed: false, includesZoomFlag: false },
  ])("$name", ({ keepZoomed, includesZoomFlag }) => {
    const adapter = new RecordingTmuxAdapter();
    adapter.switchClient("/dev/ttys016", "%1", keepZoomed);

    expect(adapter.lastArgs.includes("-Z")).toBe(includesZoomFlag);
  });
});

describe("tmux adapter mobile attach redraw", () => {
  it("attaches to the resolved pane target", () => {
    const adapter = new RecordingTmuxAdapter();

    expect(adapter.attachArgs("%1")).toEqual([
      "-S",
      "/private/tmp/mobile-agent-test.sock",
      "attach-session",
      "-f",
      "active-pane",
      "-t",
      "%1",
    ]);
  });

  it("resets and fully redraws a client after viewport reconciliation", () => {
    const adapter = new RecordingTmuxAdapter();
    adapter.refreshClient("/dev/ttys016");

    expect(adapter.lastArgs).toEqual(["refresh-client", "-t", "/dev/ttys016"]);
  });
});

describe("tmux adapter live snapshots", () => {
  it("includes a server generation in the pane identity", () => {
    const socketPath = "/private/tmp/mobile-agent-test.sock";
    const adapter = new SnapshotTmuxAdapter({
      status: 0,
      stdout: [
        "%1", "@0", "work", "shell", "0", "/tmp", "zsh", "zsh", "1", "0", "0", "80", "24", "80", "24",
        "pane-1", "", "shell", "", "", "", "", "", "1234", "2026-08-14T12:00:00Z", socketPath,
      ].join("\u001f"),
      stderr: "",
    });

    const snapshot = adapter.listPanesSnapshot();
    const scope = createHash("sha256").update(socketPath).digest("hex").slice(0, 16);

    expect(snapshot).toMatchObject({
      available: true,
      tmuxServerId: `${scope}:1234:2026-08-14T12:00:00Z`,
      tmuxServerScope: scope,
      panes: [{ paneId: "%1", tmuxServerId: `${scope}:1234:2026-08-14T12:00:00Z` }],
    });
  });

  it("marks a missing tmux server as unavailable", () => {
    const adapter = new SnapshotTmuxAdapter({ status: 1, stdout: "", stderr: "no server running on /tmp/socket\n" });

    expect(adapter.listPanesSnapshot()).toEqual({ panes: [], available: false, tmuxServerId: null, tmuxServerScope: null });
  });
});

describe("tmux agent session metadata", () => {
  it("writes execution identity before session identity", () => {
    const adapter = new MetadataTmuxAdapter("execution-id-123456");

    adapter.setAgentSessionMetadata("%1", "session-id", "execution-id-123456");

    expect(adapter.required.map((args) => args.find((value) => value.startsWith("@agentd.")))).toEqual([
      "@agentd.agent_execution_id",
      "@agentd.agent_session_id",
    ]);
  });

  it("only clears metadata for the expected execution", () => {
    const adapter = new MetadataTmuxAdapter("new-execution-123456");

    expect(adapter.clearAgentSessionMetadata("%1", "old-execution-123456")).toBe(false);
    expect(adapter.required).toEqual([]);

    expect(adapter.clearAgentSessionMetadata("%1", "new-execution-123456")).toBe(true);
    expect(adapter.required.map((args) => args.find((value) => value.startsWith("@agentd.")))).toEqual([
      "@agentd.agent_execution_id",
      "@agentd.agent_session_id",
    ]);
  });
});

class RecordingTmuxAdapter extends TmuxAdapter {
  public lastArgs: string[] = [];

  public constructor() {
    super("/private/tmp/mobile-agent-test.sock");
  }

  public override require(args: string[]): string {
    this.lastArgs = args;
    return "%2\n";
  }
}

class SnapshotTmuxAdapter extends TmuxAdapter {
  public constructor(private readonly result: { status: number; stdout: string; stderr: string }) {
    super("/private/tmp/mobile-agent-test.sock");
  }

  public override command(_args: string[]): { status: number; stdout: string; stderr: string } {
    return this.result;
  }
}

class MetadataTmuxAdapter extends TmuxAdapter {
  public required: string[][] = [];

  public constructor(private readonly executionId: string) {
    super("/private/tmp/mobile-agent-test.sock");
  }

  public override command(args: string[]): { status: number; stdout: string; stderr: string } {
    if (args[0] === "show-options") return { status: 0, stdout: `${this.executionId}\n`, stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  }

  public override require(args: string[]): string {
    this.required.push(args);
    return "";
  }
}
