import { describe, it } from "vitest";
import {
  hasError,
  returns,
  noFixture,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { resolveAgentdPaths, validateAgentdControlSocketPath } from "./paths.js";

type Context = {};
type ResolveInput = { environment: NodeJS.ProcessEnv; overrides?: Parameters<typeof resolveAgentdPaths>[1] };
type ResolvedPaths = ReturnType<typeof resolveAgentdPaths>;

const longInstanceDirectory = "/tmp/" + "a".repeat(120);
const resolveCases = [
  {
    name: "keeps the legacy default layout when no profile is configured",
    input: { environment: { HOME: "/home/test" } },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/home/test/.local/state/mobile-agent",
      databaseFile: "/home/test/.local/state/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/home/test/.local/state/mobile-agent/hooks",
      pidFile: "/home/test/.local/state/mobile-agent/agentd.sqlite.pid",
      controlSocket: "/home/test/.local/state/mobile-agent/agentd.sqlite.control.sock",
    })],
  },
  {
    name: "derives all normal paths from one instance directory",
    input: { environment: { AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/main" } },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/tmp/mobile-agent/main",
      databaseFile: "/tmp/mobile-agent/main/agentd.sqlite",
      hookOutputDirectory: "/tmp/mobile-agent/main/hooks",
      pidFile: "/tmp/mobile-agent/main/agentd.sqlite.pid",
      controlSocket: "/tmp/mobile-agent/main/agentd.sock",
    })],
  },
  {
    name: "allows explicit leaf paths as advanced overrides",
    input: {
      environment: { AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/main" },
      overrides: { databaseFile: "/var/lib/mobile-agent/agentd.sqlite", hookOutputDirectory: "/tmp/mobile-agent/hooks", pidFile: "/tmp/mobile-agent/run/agentd.pid", controlSocket: "/tmp/mobile-agent/run/agentd.sock" },
    },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/tmp/mobile-agent/main",
      databaseFile: "/var/lib/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/tmp/mobile-agent/hooks",
      pidFile: "/tmp/mobile-agent/run/agentd.pid",
      controlSocket: "/tmp/mobile-agent/run/agentd.sock",
    })],
  },
  {
    name: "preserves legacy database-derived paths without an instance directory",
    input: { environment: { HOME: "/home/test", AGENTD_DB_FILE: "/tmp/legacy.sqlite" } },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/home/test/.local/state/mobile-agent",
      databaseFile: "/tmp/legacy.sqlite",
      hookOutputDirectory: "/home/test/.local/state/mobile-agent/hooks",
      pidFile: "/tmp/legacy.sqlite.pid",
      controlSocket: "/tmp/legacy.sqlite.control.sock",
    })],
  },
  {
    name: "uses memory-specific runtime names",
    input: { environment: { AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/test" }, overrides: { databaseFile: ":memory:" } },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/tmp/mobile-agent/test",
      databaseFile: ":memory:",
      hookOutputDirectory: "/tmp/mobile-agent/test/hooks",
      pidFile: "/tmp/mobile-agent/test/agentd.pid",
      controlSocket: "/tmp/mobile-agent/test/agentd.sock",
    })],
  },
  {
    name: "does not redirect an empty instance variable into the current directory",
    input: { environment: { HOME: "/home/test", AGENTD_INSTANCE_DIR: "" } },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/home/test/.local/state/mobile-agent",
      databaseFile: "/home/test/.local/state/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/home/test/.local/state/mobile-agent/hooks",
      pidFile: "/home/test/.local/state/mobile-agent/agentd.sqlite.pid",
      controlSocket: "/home/test/.local/state/mobile-agent/agentd.sqlite.control.sock",
    })],
  },
  {
    name: "does not redirect a whitespace instance variable into the current directory",
    input: { environment: { HOME: "/home/test", AGENTD_INSTANCE_DIR: "   " } },
    assert: [returns<Context, ResolvedPaths>({
      instanceDirectory: "/home/test/.local/state/mobile-agent",
      databaseFile: "/home/test/.local/state/mobile-agent/agentd.sqlite",
      hookOutputDirectory: "/home/test/.local/state/mobile-agent/hooks",
      pidFile: "/home/test/.local/state/mobile-agent/agentd.sqlite.pid",
      controlSocket: "/home/test/.local/state/mobile-agent/agentd.sqlite.control.sock",
    })],
  },
] satisfies readonly OperationCase<"default", ResolveInput, ResolvedPaths, Context>[];

const resolveTable: OperationTable<undefined, "default", ResolveInput, ResolvedPaths, Context> = {
  defaultFixture: noFixture(),
  cases: resolveCases,
  execute: (_fixture, input) => resolveAgentdPaths(input.environment, input.overrides),
  observe: () => ({}),
};

type ValidateInput = { path: string };
const validateCases = [
  {
    name: "rejects control socket paths that cannot fit the Unix socket address",
    input: { path: resolveAgentdPaths({ AGENTD_INSTANCE_DIR: longInstanceDirectory }).controlSocket },
    assert: [hasError<Context, undefined>({ message: /control socket path is too long/ })],
  },
] satisfies readonly OperationCase<"default", ValidateInput, undefined, Context>[];

const validateTable: OperationTable<undefined, "default", ValidateInput, undefined, Context> = {
  defaultFixture: noFixture(),
  cases: validateCases,
  execute: (_fixture, input) => { validateAgentdControlSocketPath(input.path); return undefined; },
  observe: () => ({}),
};

describe("agentd instance paths", () => {
  const register = it as unknown as TestRegistrar;
  runOperationTable(register, resolveTable);
  runOperationTable(register, validateTable);
});
