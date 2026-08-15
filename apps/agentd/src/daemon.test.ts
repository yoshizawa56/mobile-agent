import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import {
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { buildDaemonSpawnArgs, type AgentdCliOptions } from "./daemon.js";

type Input = { options: AgentdCliOptions; sourceEntry: string };
type Result = string[];
type Context = {};

const cases = [
  {
    name: "starts a detached child in foreground mode without recursing",
    input: {
      options: {
        host: "127.0.0.1",
        port: 49819,
        pidFile: "/private/tmp/mobile-agent-daemon-test.pid",
        controlSocket: "/private/tmp/mobile-agent-daemon-test.sock",
        agentdBaseUrl: "http://127.0.0.1:49819",
        logLevel: "debug",
        logFile: "/private/tmp/mobile-agent-daemon-test.log",
      },
      sourceEntry: fileURLToPath(import.meta.url),
    },
    assert: [returns<Context, Result>([
      fileURLToPath(import.meta.url),
      "daemon",
      "start",
      "--foreground",
      "--host", "127.0.0.1",
      "--port", "49819",
      "--pid-file", "/private/tmp/mobile-agent-daemon-test.pid",
      "--control-socket", "/private/tmp/mobile-agent-daemon-test.sock",
      "--agentd-base-url", "http://127.0.0.1:49819",
      "--log-level", "debug",
      "--log-file", "/private/tmp/mobile-agent-daemon-test.log",
    ])],
  },
] satisfies readonly OperationCase<"default", Input, Result, Context>[];

const table: OperationTable<undefined, "default", Input, Result, Context> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) => buildDaemonSpawnArgs(input.options, input.sourceEntry),
  observe: () => ({}),
};

describe("agentd daemon lifecycle", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
