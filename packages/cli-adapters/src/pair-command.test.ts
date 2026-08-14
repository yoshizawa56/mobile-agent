import { Readable, Writable } from "node:stream";
import { relative, resolve } from "node:path";
import { describe, it } from "vitest";
import {
  hasObserved,
  noFixture,
  returns,
  runOperationTable,
  type FixtureHandle,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import type { PairDevice } from "@mobile-agent/application";
import { PairCommand, parsePairCommandOptions, type PairDeviceRuntime } from "./pair-command.js";

class CaptureOutput extends Writable {
  public value = "";
  public _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error) => void): void { this.value += chunk.toString(); callback(); }
}

type PairCommandFixture = {
  out: CaptureOutput;
  received: unknown;
  closed: boolean;
  constructed: boolean;
  controlSocket: string | null;
};
type PairCommandInput = { args: string[] };
type PairCommandContext = Omit<PairCommandFixture, "out"> & { output: string };
type PairCommandKey = "approved" | "help";
type CommandFixture = PairCommandFixture & { command: PairCommand };

const createPairCommandFixture = (kind: PairCommandKey): (() => FixtureHandle<CommandFixture>) => () => {
  const out = new CaptureOutput();
  const fixture: PairCommandFixture = { out, received: undefined, closed: false, constructed: false, controlSocket: null };
  const runtime: PairDeviceRuntime = {
    useCase: {
      execute: async (input) => {
        fixture.received = input;
        return { status: "approved", deviceId: "device-1" };
      },
    } as PairDevice,
    close: () => { fixture.closed = true; },
  };
  const command = new PairCommand({
    ...(kind === "approved" ? { env: { AGENTD_CONTROL_SOCKET: "/tmp/agentd.control.sock" } } : {}),
    io: { out, input: Readable.from([]) },
    createRuntime: async (options) => {
      fixture.constructed = true;
      fixture.controlSocket = options.controlSocket ?? null;
      if (kind === "help") throw new Error("must not be called");
      return runtime;
    },
  });
  return { fixture: Object.assign(fixture, { command }) };
};

const commandCases = [
  {
    name: "maps command options into the injected use case",
    fixture: "approved",
    input: { args: ["--web-origin", "https://web.example", "--agentd-base-url", "https://agentd.example"] },
    assert: [
      returns<PairCommandContext, number>(0),
      hasObserved<PairCommandContext, number>("received", { webOrigin: "https://web.example", agentdBaseUrl: "https://agentd.example" }),
      hasObserved<PairCommandContext, number>("output", "Approved. deviceId: device-1\n"),
      hasObserved<PairCommandContext, number>("closed", true),
      hasObserved<PairCommandContext, number>("controlSocket", "/tmp/agentd.control.sock"),
    ],
  },
  {
    name: "does not construct runtime dependencies for help",
    fixture: "help",
    input: { args: ["--help"] },
    assert: [
      returns<PairCommandContext, number>(0),
      hasObserved<PairCommandContext, number>("constructed", false),
      hasObserved<PairCommandContext, number>("output", "Usage: agent pair [--web-origin URL] [--agentd-base-url URL] [--control-socket PATH]\n"),
    ],
  },
] satisfies readonly OperationCase<PairCommandKey, PairCommandInput, number, PairCommandContext>[];

const commandTable: OperationTable<CommandFixture, PairCommandKey, PairCommandInput, number, PairCommandContext> = {
  defaultFixture: createPairCommandFixture("approved"),
  fixtures: {
    approved: createPairCommandFixture("approved"),
    help: createPairCommandFixture("help"),
  },
  cases: commandCases,
  execute: (fixture, input) => fixture.command.execute(input.args),
  observe: (fixture) => ({ output: fixture.out.value, received: fixture.received, closed: fixture.closed, constructed: fixture.constructed, controlSocket: fixture.controlSocket }),
};

type ParseInput = { args: string[]; env: NodeJS.ProcessEnv };
const parseCases = [
  {
    name: "derives the control socket from the instance directory",
    input: { args: [], env: { AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/main" } },
    assert: [returns<{}, string>("/tmp/mobile-agent/main/agentd.sock")],
  },
  {
    name: "normalizes a relative control socket override",
    input: { args: ["--control-socket", relative(process.cwd(), "/tmp/mobile-agent-agentd.sock")], env: {} },
    assert: [returns<{}, string>(resolve("/tmp/mobile-agent-agentd.sock"))],
  },
] satisfies readonly OperationCase<"default", ParseInput, string, {}>[];

const parseTable: OperationTable<undefined, "default", ParseInput, string, {}> = {
  defaultFixture: noFixture(),
  cases: parseCases,
  execute: (_fixture, input) => parsePairCommandOptions(input.args, input.env).controlSocket,
  observe: () => ({}),
};

describe("agent pair CLI adapter", () => {
  const register = it as unknown as TestRegistrar;
  runOperationTable(register, parseTable);
  runOperationTable(register, commandTable);
});
