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
