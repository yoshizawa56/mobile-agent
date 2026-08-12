import { describe, expect, it } from "vitest";
import { terminalProtocolVersion } from "@mobile-agent/protocol";
import {
  createTerminalAttachMessage,
  handleControlMessage,
  resumeStateFromReady,
  type PaneResumeState,
} from "./pane-viewmodel";

describe("terminal pane handshake helpers", () => {
  it("creates a versioned initial attach without resume credentials", () => {
    expect(createTerminalAttachMessage({ target: "%3", cols: 80, rows: 24 })).toEqual({
      type: "attach",
      version: terminalProtocolVersion,
      target: "%3",
      cols: 80,
      rows: 24,
    });
  });

  it("adds resume credentials only when they belong to the selected pane", () => {
    const resume: PaneResumeState = {
      sessionId: "terminal-1",
      resumeToken: "secret",
      target: "%3",
    };
    expect(createTerminalAttachMessage({ target: "%3", cols: 100, rows: 30, resume })).toMatchObject({
      type: "attach",
      version: terminalProtocolVersion,
      sessionId: "terminal-1",
      resumeToken: "secret",
    });
    expect(createTerminalAttachMessage({ target: "%4", cols: 100, rows: 30, resume })).not.toHaveProperty("resumeToken");
  });

  it("keeps control frames separate and exposes the resumed ready state", () => {
    const events: string[] = [];
    let resumed = false;
    handleControlMessage(JSON.stringify({
      type: "ready",
      version: terminalProtocolVersion,
      sessionId: "terminal-1",
      resumeToken: "secret",
      resumed: true,
      target: "%3",
      paneId: "%3",
      windowId: "@1",
      cols: 80,
      rows: 24,
    }), {
      onReady: (message) => {
        resumed = message.resumed;
        events.push(`ready:${message.sessionId}`);
      },
      onClosed: (message) => events.push(`closed:${message.reason}`),
      onError: (message) => events.push(`error:${message.code}`),
      onViewport: (owner, reason) => events.push(`viewport:${owner}:${reason}`),
    });

    expect(resumed).toBe(true);
    expect(events).toEqual(["ready:terminal-1"]);
    expect(resumeStateFromReady({
      type: "ready",
      version: terminalProtocolVersion,
      sessionId: "terminal-1",
      resumeToken: "secret",
      resumed: true,
      target: "%3",
      paneId: "%3",
      windowId: "@1",
      cols: 80,
      rows: 24,
    }, "%3")).toEqual({ sessionId: "terminal-1", resumeToken: "secret", target: "%3" });
  });

  it("reports invalid control data without treating it as retryable", () => {
    const errors: Array<{ code: string; retryable: boolean }> = [];
    handleControlMessage("not-json", {
      onReady: () => undefined,
      onClosed: () => undefined,
      onError: (message) => errors.push({ code: message.code, retryable: message.retryable }),
      onViewport: () => undefined,
    });

    expect(errors).toEqual([{ code: "invalid_control_frame", retryable: false }]);
  });
});
