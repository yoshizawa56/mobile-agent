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
} from "@muximo/test-support";
import {
  buildDaemonSpawnArgs,
  consumeRestartMarker,
  disposeOwnedOpenCodeServers,
  hasRestartMarker,
  writeRestartMarker,
  type MuximodCliOptions,
} from "./daemon.js";

type Input = { options: MuximodCliOptions; sourceEntry: string };
type Result = string[];
type Context = {};

const cases = [
  {
    name: "starts a detached child in foreground mode without recursing",
    input: {
      options: {
        host: "127.0.0.1",
        port: 49819,
        pidFile: "/private/tmp/muximo-daemon-test.pid",
        controlSocket: "/private/tmp/muximo-daemon-test.sock",
        muximodBaseUrl: "http://127.0.0.1:49819",
        logLevel: "debug",
        logFile: "/private/tmp/muximo-daemon-test.log",
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
      "--pid-file", "/private/tmp/muximo-daemon-test.pid",
      "--control-socket", "/private/tmp/muximo-daemon-test.sock",
      "--muximod-base-url", "http://127.0.0.1:49819",
      "--log-level", "debug",
      "--log-file", "/private/tmp/muximo-daemon-test.log",
    ])],
  },
] satisfies readonly OperationCase<"default", Input, Result, Context>[];

const table: OperationTable<undefined, "default", Input, Result, Context> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) => buildDaemonSpawnArgs(input.options, input.sourceEntry),
  observe: () => ({}),
};

describe("muximod daemon lifecycle", () => {
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
    const root = mkdtempSync(join(tmpdir(), "muximo-daemon-cleanup-"));
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

describe("muximod owned runtime cleanup", () => {
  runOperationTable(it as unknown as TestRegistrar, cleanupTable);
});

type MarkerInput = { refreshServers?: boolean };
type MarkerResult = { present: boolean; consumed: boolean | undefined; consumedAgain: boolean | undefined };

const markerCases = [
  {
    name: "a restart marker without refresh keeps the servers",
    input: {},
    assert: [returns<MarkerContext, MarkerResult>({ present: true, consumed: false, consumedAgain: undefined })],
  },
  {
    name: "a restart marker defaults to keeping servers and is consumed once",
    input: { refreshServers: false },
    assert: [returns<MarkerContext, MarkerResult>({ present: true, consumed: false, consumedAgain: undefined })],
  },
  {
    name: "a restart marker with refresh is reported once",
    input: { refreshServers: true },
    assert: [returns<MarkerContext, MarkerResult>({ present: true, consumed: true, consumedAgain: undefined })],
  },
] satisfies readonly OperationCase<"default", MarkerInput, MarkerResult, MarkerContext>[];

type MarkerContext = {};

const markerTable: OperationTable<undefined, "default", MarkerInput, MarkerResult, MarkerContext> = {
  defaultFixture: noFixture(),
  cases: markerCases,
  execute: (_fixture, input) => {
    const root = mkdtempSync(join(tmpdir(), "muximo-daemon-marker-"));
    try {
      const pidFile = join(root, "muximod.pid");
      writeRestartMarker(pidFile, input.refreshServers === true);
      const present = hasRestartMarker(pidFile);
      const consumed = consumeRestartMarker(pidFile);
      return {
        present,
        consumed,
        consumedAgain: consumeRestartMarker(pidFile),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  observe: () => ({}),
};

describe("muximod restart marker", () => {
  runOperationTable(it as unknown as TestRegistrar, markerTable);
});
