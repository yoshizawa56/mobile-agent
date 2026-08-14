import { describe, expect, it } from "vitest";
import { resolveAgentdPaths, validateAgentdControlSocketPath } from "./paths.js";

describe("agentd instance paths", () => {
  it("keeps the legacy default layout when no profile is configured", () => {
    expect(resolveAgentdPaths({ HOME: "/home/test" })).toEqual({
      instanceDirectory: "/home/test/.local/state/mobile-agent",
      databaseFile: "/home/test/.local/state/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/home/test/.local/state/mobile-agent/hooks",
      pidFile: "/home/test/.local/state/mobile-agent/agentd.sqlite.pid",
      controlSocket: "/home/test/.local/state/mobile-agent/agentd.sqlite.control.sock",
    });
  });

  it("derives all normal paths from one instance directory", () => {
    expect(resolveAgentdPaths({ AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/main" })).toEqual({
      instanceDirectory: "/tmp/mobile-agent/main",
      databaseFile: "/tmp/mobile-agent/main/agentd.sqlite",
      hookOutputDirectory: "/tmp/mobile-agent/main/hooks",
      pidFile: "/tmp/mobile-agent/main/agentd.sqlite.pid",
      controlSocket: "/tmp/mobile-agent/main/agentd.sock",
    });
  });

  it("allows explicit leaf paths as advanced overrides", () => {
    expect(resolveAgentdPaths({ AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/main" }, {
      databaseFile: "/var/lib/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/tmp/mobile-agent/hooks",
      pidFile: "/tmp/mobile-agent/run/agentd.pid",
      controlSocket: "/tmp/mobile-agent/run/agentd.sock",
    })).toEqual({
      instanceDirectory: "/tmp/mobile-agent/main",
      databaseFile: "/var/lib/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/tmp/mobile-agent/hooks",
      pidFile: "/tmp/mobile-agent/run/agentd.pid",
      controlSocket: "/tmp/mobile-agent/run/agentd.sock",
    });
  });

  it("preserves legacy database-derived paths without an instance directory", () => {
    expect(resolveAgentdPaths({ HOME: "/home/test", AGENTD_DB_FILE: "/tmp/legacy.sqlite" })).toMatchObject({
      instanceDirectory: "/home/test/.local/state/mobile-agent",
      databaseFile: "/tmp/legacy.sqlite",
      hookOutputDirectory: "/home/test/.local/state/mobile-agent/hooks",
      pidFile: "/tmp/legacy.sqlite.pid",
      controlSocket: "/tmp/legacy.sqlite.control.sock",
    });
  });

  it("uses memory-specific runtime names", () => {
    expect(resolveAgentdPaths({ AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/test" }, { databaseFile: ":memory:" })).toMatchObject({
      databaseFile: ":memory:",
      pidFile: "/tmp/mobile-agent/test/agentd.pid",
      controlSocket: "/tmp/mobile-agent/test/agentd.sock",
    });
  });

  it("does not redirect an empty instance variable into the current directory", () => {
    expect(resolveAgentdPaths({ HOME: "/home/test", AGENTD_INSTANCE_DIR: "" }).instanceDirectory)
      .toBe("/home/test/.local/state/mobile-agent");
    expect(resolveAgentdPaths({ HOME: "/home/test", AGENTD_INSTANCE_DIR: "   " }).instanceDirectory)
      .toBe("/home/test/.local/state/mobile-agent");
  });

  it("rejects control socket paths that cannot fit the Unix socket address", () => {
    const paths = resolveAgentdPaths({ AGENTD_INSTANCE_DIR: `/tmp/${"a".repeat(120)}` });
    expect(() => validateAgentdControlSocketPath(paths.controlSocket)).toThrow("control socket path is too long");
  });
});
