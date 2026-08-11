import { describe, expect, it } from "vitest";
import {
  connectingPath,
  panePath,
  parseWorkspaceRoute,
  sessionPath,
  sessionsPath,
} from "./workspace-routes";

describe("parseWorkspaceRoute", () => {
  it.each([
    {
      pathname: "/",
      expected: { stage: "terminals", terminalId: null, sessionName: null, paneId: null },
    },
    {
      pathname: "/terminals",
      expected: { stage: "terminals", terminalId: null, sessionName: null, paneId: null },
    },
    {
      pathname: "/settings",
      expected: { stage: "settings", terminalId: null, sessionName: null, paneId: null },
    },
    {
      pathname: "/terminals/macbook-air/sessions",
      expected: { stage: "sessions", terminalId: "macbook-air", sessionName: null, paneId: null },
    },
    {
      pathname: "/terminals/macbook-air/sessions/mobile-agent",
      expected: { stage: "session-overview", terminalId: "macbook-air", sessionName: "mobile-agent", paneId: null },
    },
    {
      pathname: "/terminals/macbook-air/sessions/mobile-agent/connecting",
      expected: { stage: "connecting", terminalId: "macbook-air", sessionName: "mobile-agent", paneId: null },
    },
    {
      pathname: "/terminals/macbook-air/sessions/mobile-agent/panes/pane-review",
      expected: { stage: "control-room", terminalId: "macbook-air", sessionName: "mobile-agent", paneId: "pane-review" },
    },
    {
      pathname: "/terminals/macbook-air/sessions/mobile-agent/panes/%250",
      expected: { stage: "control-room", terminalId: "macbook-air", sessionName: "mobile-agent", paneId: "%0" },
    },
  ])("maps $pathname to a stable workspace location", ({ pathname, expected }) => {
    expect(parseWorkspaceRoute(pathname)).toEqual(expected);
  });
});

describe("workspace route builders", () => {
  it.each([
    [sessionsPath("macbook-air"), "/terminals/macbook-air/sessions"],
    [sessionPath("macbook-air", "mobile agent"), "/terminals/macbook-air/sessions/mobile%20agent"],
    [connectingPath("macbook-air", "mobile-agent"), "/terminals/macbook-air/sessions/mobile-agent/connecting"],
    [panePath("macbook-air", "mobile-agent", "pane-review"), "/terminals/macbook-air/sessions/mobile-agent/panes/pane-review"],
  ])("builds %s", (actual, expected) => {
    expect(actual).toBe(expected);
  });
});
