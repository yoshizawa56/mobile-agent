import { describe, expect, it } from "vitest";
import { buildServeArgs, buildServeHttpUrl, buildServeUrl, parseTailscaleHostname } from "./index.js";

describe("tailscale serve adapter", () => {
  it.each([
    { localPort: 4317, externalPort: 443, args: ["serve", "--bg", "--https=443", "--yes", "http://127.0.0.1:4317"] },
    { localPort: 1, externalPort: 8449, args: ["serve", "--bg", "--https=8449", "--yes", "http://127.0.0.1:1"] },
  ])("builds a persistent HTTPS Serve command", ({ localPort, externalPort, args }) => {
    expect(buildServeArgs({ localPort, externalPort })).toEqual(args);
  });

  it("builds a path-mounted Serve command", () => {
    expect(buildServeArgs({ localPort: 4317, externalPort: 443, path: "agentd" })).toEqual([
      "serve", "--bg", "--https=443", "--yes", "--set-path=/agentd", "http://127.0.0.1:4317",
    ]);
  });

  it("builds a websocket URL for the Serve endpoint", () => {
    expect(buildServeUrl("host.tailnet.ts.net", "agent")).toBe("wss://host.tailnet.ts.net/agent");
  });

  it.each([
    { port: 443, expected: "https://host.tailnet.ts.net/" },
    { port: 8449, expected: "https://host.tailnet.ts.net:8449/" },
  ])("builds an HTTPS Serve URL without a port for 443", ({ port, expected }) => {
    expect(buildServeHttpUrl("host.tailnet.ts.net", port)).toBe(expected);
  });

  it("reads the current node DNS name from Tailscale status JSON", () => {
    expect(parseTailscaleHostname(JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } }))).toBe("host.tailnet.ts.net");
    expect(parseTailscaleHostname("not json")).toBeUndefined();
  });

  it("rejects an invalid port", () => {
    expect(() => buildServeArgs({ localPort: 65_536, externalPort: 443 })).toThrow("Invalid Tailscale Serve port");
    expect(() => buildServeArgs({ localPort: 4317, externalPort: 65_536 })).toThrow("Invalid Tailscale Serve external port");
  });
});
