import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { buildDaemonSpawnArgs, disposeOwnedOpenCodeServers, type AgentdCliOptions } from "./daemon.js";

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

type CleanupInput = { registryEntries: number; staleLock: boolean };
type CleanupResult = { registryAfter: Record<string, unknown>; completed: boolean };

const cleanupCases = [
  {
    name: "clears the owned-server registry when the daemon shuts down",
    input: { registryEntries: 1, staleLock: false },
    assert: [returns<CleanupContext, CleanupResult>({ registryAfter: {}, completed: true })],
  },
  {
    name: "completes even when a stale lock was left behind",
    input: { registryEntries: 1, staleLock: true },
    assert: [returns<CleanupContext, CleanupResult>({ registryAfter: {}, completed: true })],
  },
  {
    name: "handles an empty registry",
    input: { registryEntries: 0, staleLock: false },
    assert: [returns<CleanupContext, CleanupResult>({ registryAfter: {}, completed: true })],
  },
] satisfies readonly OperationCase<"default", CleanupInput, CleanupResult, CleanupContext>[];

type CleanupContext = {};

const cleanupTable: OperationTable<undefined, "default", CleanupInput, CleanupResult, CleanupContext> = {
  defaultFixture: noFixture(),
  cases: cleanupCases,
  execute: async (_fixture, input) => {
    const root = mkdtempSync(join(tmpdir(), "mobile-agent-daemon-cleanup-"));
    const registryFile = join(root, "opencode-servers.json");
    try {
      if (input.registryEntries > 0) {
        writeFileSync(registryFile, JSON.stringify({
          "/workspace": { pid: 999_999, port: 41_000, version: "1.2.3", startedAt: "2026-08-15T00:00:00.000Z" },
        }));
      } else {
        writeFileSync(registryFile, "{}");
      }
      if (input.staleLock) writeFileSync(`${registryFile}.lock`, "999999\n");
      await disposeOwnedOpenCodeServers({ registryFile });
      return {
        registryAfter: JSON.parse(readFileSync(registryFile, "utf8")) as Record<string, unknown>,
        completed: true,
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  observe: () => ({}),
};

describe("agentd owned runtime cleanup", () => {
  runOperationTable(it as unknown as TestRegistrar, cleanupTable);
});
