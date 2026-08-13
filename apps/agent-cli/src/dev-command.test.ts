import { describe, expect, it } from "vitest";
import { parseDevServeProvider } from "./dev-command.js";

describe("agent dev command", () => {
  it("runs the local stack without an exposure provider by default", () => {
    expect(parseDevServeProvider([])).toBeUndefined();
  });

  it("selects Tailscale as the source development exposure provider", () => {
    expect(parseDevServeProvider(["serve", "tailscale"])).toBe("tailscale");
  });

  it("rejects unsupported development exposure providers", () => {
    expect(() => parseDevServeProvider(["serve", "ngrok"])).toThrow("unsupported dev serve provider");
  });
});
