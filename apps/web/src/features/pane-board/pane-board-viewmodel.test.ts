import { describe, it } from "vitest";
import {
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { paneStateLabel } from "./pane-board-viewmodel";

type Input = { state: "waiting_input" | "waiting_approval" | "running" | "failed" };
type Context = {};

const cases = [
  { name: "labels input waiting", input: { state: "waiting_input" as const }, assert: [returns<Context, string>("入力待ち")] },
  { name: "labels approval waiting", input: { state: "waiting_approval" as const }, assert: [returns<Context, string>("承認待ち")] },
  { name: "labels running", input: { state: "running" as const }, assert: [returns<Context, string>("実行中")] },
  { name: "labels failure", input: { state: "failed" as const }, assert: [returns<Context, string>("失敗")] },
] satisfies readonly OperationCase<"default", Input, string, Context>[];

const table: OperationTable<undefined, "default", Input, string, Context> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) => paneStateLabel(input.state),
  observe: () => ({}),
};

describe("pane board view model helpers", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
