import { describe, expect, it } from "vitest";
import {
  clearBrowserConnectionProfile,
  normalizeServeUrl,
  readBrowserConnectionProfile,
  saveBrowserConnectionProfile,
} from "./connection-profile-store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("browser connection profile", () => {
  it.each([
    { input: "https://workstation.tailnet.ts.net/", expected: "https://workstation.tailnet.ts.net" },
    { input: "https://workstation.tailnet.ts.net:8449/", expected: "https://workstation.tailnet.ts.net:8449" },
    { input: "https://example.test/agentd/?ignored=1", expected: "https://example.test/agentd" },
  ])("normalizes a non-secret Serve URL", ({ input, expected }) => {
    expect(normalizeServeUrl(input)).toBe(expected);
  });

  it("round-trips a profile without credentials", () => {
    const storage = new MemoryStorage();
    const saved = saveBrowserConnectionProfile({ name: "Workstation", serveUrl: "https://workstation.tailnet.ts.net/" }, storage);
    const loaded = readBrowserConnectionProfile(storage);

    expect(loaded).toEqual(saved);
    expect(storage.getItem("mobile-agent.connection-profile.v1")).not.toContain("key");
    expect(storage.getItem("mobile-agent.connection-profile.v1")).not.toContain("password");
  });

  it("ignores malformed stored data and can clear a profile", () => {
    const storage = new MemoryStorage();
    storage.setItem("mobile-agent.connection-profile.v1", "not-json");
    expect(readBrowserConnectionProfile(storage)).toBeNull();
    saveBrowserConnectionProfile({ name: "Workstation", serveUrl: "https://workstation.tailnet.ts.net" }, storage);
    clearBrowserConnectionProfile(storage);
    expect(readBrowserConnectionProfile(storage)).toBeNull();
  });
});
