import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDaemonSpawnArgs, type AgentdCliOptions } from "./daemon.js";

describe("agentd daemon lifecycle", () => {
  it("starts a detached child in foreground mode without recursing", () => {
    const options: AgentdCliOptions = {
      host: "127.0.0.1",
      port: 49819,
      pidFile: "/private/tmp/mobile-agent-daemon-test.pid",
      controlSocket: "/private/tmp/mobile-agent-daemon-test.sock",
      webOrigin: "http://localhost:5227",
      agentdBaseUrl: "http://127.0.0.1:49819",
    };

    const sourceEntry = fileURLToPath(import.meta.url);
    expect(buildDaemonSpawnArgs(options, sourceEntry)).toEqual([
      sourceEntry,
      "daemon",
      "start",
      "--foreground",
      "--host", "127.0.0.1",
      "--port", "49819",
      "--pid-file", "/private/tmp/mobile-agent-daemon-test.pid",
      "--control-socket", "/private/tmp/mobile-agent-daemon-test.sock",
      "--web-origin", "http://localhost:5227",
      "--agentd-base-url", "http://127.0.0.1:49819",
    ]);
  });
});
