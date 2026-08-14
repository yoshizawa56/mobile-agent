import { describe, it } from "vitest";
import {
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";

type Input = { env: string | undefined };
type Context = {};

const cases = [
  {
    name: "uses the local health endpoint by default",
    input: { env: undefined },
    assert: [returns<Context, string>("http://127.0.0.1:4317")],
  },
  {
    name: "removes a trailing slash from a configured endpoint",
    input: { env: "https://host.example/" },
    assert: [returns<Context, string>("https://host.example")],
  },
] satisfies readonly OperationCase<"default", Input, string, Context>[];

const table: OperationTable<undefined, "default", Input, string, Context> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) =>
    (input.env ?? "http://127.0.0.1:4317").replace(/\/$/, ""),
  observe: () => ({}),
};

describe("agent cli output contract", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
