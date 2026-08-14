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

describe("tmux adapter managed session setup", () => {
  it("passes a wrapper command when creating a session", () => {
    const adapter = new RecordingTmuxAdapter();
    adapter.createSession("work", "/tmp/project", "agent shell");

    expect(adapter.lastArgs).toEqual([
      "new-session",
      "-d",
      "-s",
      "work",
      "-c",
      "/tmp/project",
      "agent shell",
    ]);
  });

  it("uses session options and environment for managed wrappers", () => {
    const adapter = new RecordingTmuxAdapter();
    adapter.setSessionOption("work", "default-command", "agent shell");
    expect(adapter.lastArgs).toEqual(["set-option", "-t", "work", "default-command", "agent shell"]);

    adapter.setSessionEnvironment("work", "AGENTD_MANAGED_SESSION_ID", "session-1");
    expect(adapter.lastArgs).toEqual(["set-environment", "-t", "work", "AGENTD_MANAGED_SESSION_ID", "session-1"]);
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

describe("tmux adapter pane listing", () => {
  it("keeps the pane index separate from the server-wide pane id", () => {
    const adapter = new ListingTmuxAdapter();

    expect(adapter.listPanes()).toMatchObject([{
      paneId: "%32",
      windowIndex: 2,
      paneIndex: 4,
    }]);
    expect(adapter.lastArgs).toEqual([
      "list-panes",
      "-a",
      "-F",
      expect.stringContaining("#{pane_index}"),
    ]);
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

class RecordingTmuxAdapter extends TmuxAdapter {
  public lastArgs: string[] = [];

  public constructor() {
    super("/private/tmp/mobile-agent-test.sock");
  }

  public override require(args: string[]): string {
    this.lastArgs = args;
    return "%2\n";
  }

  public override command(args: string[]) {
    this.lastArgs = args;
    return { status: 0, stdout: "", stderr: "" };
  }
}

class ListingTmuxAdapter extends TmuxAdapter {
  public lastArgs: string[] = [];

  public constructor() {
    super("/private/tmp/mobile-agent-test.sock");
  }

  public override command(args: string[]) {
    this.lastArgs = args;
    const separator = "\u001f";
    return {
      status: 0,
      stdout: [
        "%32",
        "@5",
        "agentd",
        "code",
        "2",
        "4",
        "/tmp",
        "zsh",
        "zsh",
        "1",
        "0",
        "0",
        "80",
        "24",
        "120",
        "40",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(separator) + "\n",
      stderr: "",
    };
  }
}
