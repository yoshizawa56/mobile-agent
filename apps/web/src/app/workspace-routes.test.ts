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
  connectingPath,
  panePath,
  parseWorkspaceRoute,
  sessionPath,
  sessionsPath,
} from "./workspace-routes";

type Route = ReturnType<typeof parseWorkspaceRoute>;
type Context = {};

const routeCase = (
  name: string,
  pathname: string,
  expected: Route,
): OperationCase<"default", { pathname: string }, Route, Context> => ({
  name,
  input: { pathname },
  assert: [returns<Context, Route>(expected)],
});

const parseCases = [
  routeCase("maps the root", "/", { stage: "terminals", terminalId: null, sessionName: null, paneId: null }),
  routeCase("maps the terminals route", "/terminals", { stage: "terminals", terminalId: null, sessionName: null, paneId: null }),
  routeCase("maps the settings route", "/settings", { stage: "settings", terminalId: null, sessionName: null, paneId: null }),
  routeCase("maps the sessions route", "/terminals/macbook-air/sessions", { stage: "sessions", terminalId: "macbook-air", sessionName: null, paneId: null }),
  routeCase("maps the session overview route", "/terminals/macbook-air/sessions/muximo", { stage: "session-overview", terminalId: "macbook-air", sessionName: "muximo", paneId: null }),
  routeCase("maps the connecting route", "/terminals/macbook-air/sessions/muximo/connecting", { stage: "connecting", terminalId: "macbook-air", sessionName: "muximo", paneId: null }),
  routeCase("maps the control room route", "/terminals/macbook-air/sessions/muximo/panes/pane-review", { stage: "control-room", terminalId: "macbook-air", sessionName: "muximo", paneId: "pane-review" }),
  routeCase("decodes a legacy tmux pane route", "/terminals/macbook-air/sessions/muximo/panes/%250", { stage: "control-room", terminalId: "macbook-air", sessionName: "muximo", paneId: "%0" }),
] satisfies readonly OperationCase<"default", { pathname: string }, Route, Context>[];

const parseTable: OperationTable<undefined, "default", { pathname: string }, Route, Context> = {
  defaultFixture: noFixture(),
  cases: parseCases,
  execute: (_fixture, input) => parseWorkspaceRoute(input.pathname),
  observe: () => ({}),
};

const sessionCases = [
  { name: "builds a sessions path", input: { terminalId: "macbook-air" }, assert: [returns<Context, string>("/terminals/macbook-air/sessions")] },
] satisfies readonly OperationCase<"default", { terminalId: string }, string, Context>[];

const sessionTable: OperationTable<undefined, "default", { terminalId: string }, string, Context> = {
  defaultFixture: noFixture(),
  cases: sessionCases,
  execute: (_fixture, input) => sessionsPath(input.terminalId),
  observe: () => ({}),
};

const overviewCases = [
  { name: "builds a URL-encoded session path", input: { terminalId: "macbook-air", sessionName: "muximo agent" }, assert: [returns<Context, string>("/terminals/macbook-air/sessions/muximo%20agent")] },
] satisfies readonly OperationCase<"default", { terminalId: string; sessionName: string }, string, Context>[];

const overviewTable: OperationTable<undefined, "default", { terminalId: string; sessionName: string }, string, Context> = {
  defaultFixture: noFixture(),
  cases: overviewCases,
  execute: (_fixture, input) => sessionPath(input.terminalId, input.sessionName),
  observe: () => ({}),
};

const connectingCases = [
  { name: "builds a connecting path", input: { terminalId: "macbook-air", sessionName: "muximo" }, assert: [returns<Context, string>("/terminals/macbook-air/sessions/muximo/connecting")] },
] satisfies readonly OperationCase<"default", { terminalId: string; sessionName: string }, string, Context>[];

const connectingTable: OperationTable<undefined, "default", { terminalId: string; sessionName: string }, string, Context> = {
  defaultFixture: noFixture(),
  cases: connectingCases,
  execute: (_fixture, input) => connectingPath(input.terminalId, input.sessionName),
  observe: () => ({}),
};

const paneCases = [
  { name: "builds a pane path", input: { terminalId: "macbook-air", sessionName: "muximo", paneId: "pane-review" }, assert: [returns<Context, string>("/terminals/macbook-air/sessions/muximo/panes/pane-review")] },
] satisfies readonly OperationCase<"default", { terminalId: string; sessionName: string; paneId: string }, string, Context>[];

const paneTable: OperationTable<undefined, "default", { terminalId: string; sessionName: string; paneId: string }, string, Context> = {
  defaultFixture: noFixture(),
  cases: paneCases,
  execute: (_fixture, input) => panePath(input.terminalId, input.sessionName, input.paneId),
  observe: () => ({}),
};

describe("workspace routes", () => {
  runOperationTable(it as unknown as TestRegistrar, parseTable);
  runOperationTable(it as unknown as TestRegistrar, sessionTable);
  runOperationTable(it as unknown as TestRegistrar, overviewTable);
  runOperationTable(it as unknown as TestRegistrar, connectingTable);
  runOperationTable(it as unknown as TestRegistrar, paneTable);
});
