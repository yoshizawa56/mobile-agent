import { describe, it } from "vitest";
import {
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { parseGlobalOptions } from "./global-options.js";

type Input = { args: string[] };
type Result = { args: string[]; verbose: boolean };
type Context = {};

const cases = [
  {
    name: "consumes leading verbose flags before the command",
    input: { args: ["-v", "--verbose", "run", "claude"] },
    assert: [returns<Context, Result>({ args: ["run", "claude"], verbose: true })],
  },
  {
    name: "leaves command arguments untouched after the command starts",
    input: { args: ["run", "claude", "-v"] },
    assert: [returns<Context, Result>({ args: ["run", "claude", "-v"], verbose: false })],
  },
] satisfies readonly OperationCase<"default", Input, Result, Context>[];

const table: OperationTable<undefined, "default", Input, Result, Context> = {
  defaultFixture: () => ({ fixture: undefined }),
  cases,
  execute: (_fixture, input) => parseGlobalOptions(input.args),
  observe: () => ({}),
};

describe("agent global options", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
