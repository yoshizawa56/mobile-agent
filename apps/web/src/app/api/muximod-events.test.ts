import { describe, it } from "vitest";
import { muximodEventSchema } from "@muximo/contract";
import {
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@muximo/test-support";
import { invalidationQueryKeys } from "./muximod-events";

const connection = {
  route: "serve" as const,
  httpBaseUrl: "http://muximod.local",
  websocketUrl: "ws://muximod.local/terminal",
};

type Input = { event: ReturnType<typeof muximodEventSchema.parse> };
type Result = readonly (readonly unknown[])[];
type Context = {};

const cases = [
  {
    name: "invalidates the session summary and its pane list",
    input: {
      event: muximodEventSchema.parse({
        type: "session_updated",
        sessionName: "work",
        reason: "pane_created",
        revision: 4,
      }),
    },
    assert: [
      returns<Context, Result>([
        ["sessions", "serve:http://muximod.local"],
        ["panes", "http://muximod.local", "work"],
      ]),
    ],
  },
] satisfies readonly OperationCase<"default", Input, Result, Context>[];

const table: OperationTable<undefined, "default", Input, Result, Context> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) =>
    invalidationQueryKeys("serve:http://muximod.local", connection, input.event),
  observe: () => ({}),
};

describe("muximod event query invalidation", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
