import { describe, expect, it } from "vitest";
import { AgentPluginRegistry, shellPlugin } from "./index.js";

describe("agent plugin registry", () => {
  it("registers and lists plugin manifests", () => {
    const registry = new AgentPluginRegistry();
    registry.register(shellPlugin);
    expect(registry.get("shell")).toBe(shellPlugin);
    expect(registry.list()).toEqual([shellPlugin.manifest]);
  });

  it("detects ordinary shells and emits an exit observation", async () => {
    await expect(
      shellPlugin.detect({ command: "/bin/zsh", args: [], cwd: "/tmp", environment: {} }),
    ).resolves.toMatchObject({ agentId: "shell", confidence: 1 });
    expect(shellPlugin.createObserver().onExit({ code: 0, signal: null })).toEqual([
      { type: "state_changed", state: "completed", reason: "shell exited" },
    ]);
  });
});
