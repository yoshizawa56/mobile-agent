import { describe, it } from "vitest";
import { agentdEventSchema } from "@mobile-agent/protocol";
import {
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { invalidationQueryKeys } from "./agentd-events";

const connection = {
  route: "serve" as const,
  httpBaseUrl: "http://agentd.local",
  websocketUrl: "ws://agentd.local/terminal",
  eventsWebsocketUrl: "ws://agentd.local/events",
};

type Input = { event: ReturnType<typeof agentdEventSchema.parse> };
type Result = readonly (readonly unknown[])[];
type Context = {};

const cases = [
  {
    name: "invalidates the session summary and its pane list",
    input: {
      event: agentdEventSchema.parse({
        type: "session_updated",
        sessionName: "work",
        reason: "pane_created",
        revision: 4,
      }),
    },
    assert: [
      returns<Context, Result>([
        ["sessions", "serve:http://agentd.local"],
        ["panes", "http://agentd.local", "work"],
      ]),
    ],
  },
] satisfies readonly OperationCase<"default", Input, Result, Context>[];

const table: OperationTable<undefined, "default", Input, Result, Context> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) =>
    invalidationQueryKeys("serve:http://agentd.local", connection, input.event),
  observe: () => ({}),
};

describe("agentd event query invalidation", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
