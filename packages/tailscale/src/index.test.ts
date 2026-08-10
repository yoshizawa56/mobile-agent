import { describe, expect, it } from "vitest";
import { buildServeArgs, buildServeUrl } from "./index.js";

describe("tailscale serve adapter", () => {
  it.each([
    { port: 4317, args: ["serve", "4317"] },
    { port: 1, args: ["serve", "1"] },
  ])("builds the current foreground Serve command", ({ port, args }) => {
    expect(buildServeArgs({ localPort: port })).toEqual(args);
  });

  it("builds a websocket URL for the Serve endpoint", () => {
    expect(buildServeUrl("host.tailnet.ts.net", "agent")).toBe("wss://host.tailnet.ts.net/agent");
  });

  it("rejects an invalid port", () => {
    expect(() => buildServeArgs({ localPort: 65_536 })).toThrow("Invalid Tailscale Serve port");
  });
});
