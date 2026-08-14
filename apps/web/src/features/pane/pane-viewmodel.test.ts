import { describe, it } from "vitest";
import { terminalProtocolVersion, type ClientControlMessage, type ServerControlMessage } from "@mobile-agent/protocol";
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
import {
  createTerminalAttachMessage,
  handleControlMessage,
  resumeStateFromReady,
  type PaneResumeState,
  type PaneViewportOwner,
} from "./pane-viewmodel";

type EmptyContext = {};
type AttachResult = Extract<ClientControlMessage, { type: "attach" }>;
type AttachInput = { target: string; cols: number; rows: number; resume?: PaneResumeState };

const attachCases = [
  {
    name: "creates a versioned initial attach without resume credentials",
    input: { target: "%3", cols: 80, rows: 24 },
    assert: [returns<EmptyContext, AttachResult>({ type: "attach", version: terminalProtocolVersion, target: "%3", cols: 80, rows: 24 })],
  },
  {
    name: "adds resume credentials for the selected pane",
    input: { target: "%3", cols: 100, rows: 30, resume: { sessionId: "terminal-1", resumeToken: "secret", target: "%3" } },
    assert: [returns<EmptyContext, AttachResult>({ type: "attach", version: terminalProtocolVersion, target: "%3", cols: 100, rows: 30, sessionId: "terminal-1", resumeToken: "secret" })],
  },
  {
    name: "does not reuse resume credentials for another pane",
    input: { target: "%4", cols: 100, rows: 30, resume: { sessionId: "terminal-1", resumeToken: "secret", target: "%3" } },
    assert: [returns<EmptyContext, AttachResult>({ type: "attach", version: terminalProtocolVersion, target: "%4", cols: 100, rows: 30 })],
  },
] satisfies readonly OperationCase<"default", AttachInput, AttachResult, EmptyContext>[];

const attachTable: OperationTable<undefined, "default", AttachInput, AttachResult, EmptyContext> = {
  defaultFixture: noFixture(),
  cases: attachCases,
  execute: (_fixture, input) => createTerminalAttachMessage(input),
  observe: () => ({}),
};

type ReadyMessage = Extract<ServerControlMessage, { type: "ready" }>;
const readyMessage: ReadyMessage = {
  type: "ready",
  version: terminalProtocolVersion,
  sessionId: "terminal-1",
  resumeToken: "secret",
  resumed: true,
  target: "%3",
  paneId: "%3",
  windowId: "@1",
  cols: 80,
  rows: 24,
};

type ResumeInput = { message: ReadyMessage; target: string };
const resumeCases = [
  { name: "exposes the resumed ready state", input: { message: readyMessage, target: "%3" }, assert: [returns<EmptyContext, PaneResumeState>({ sessionId: "terminal-1", resumeToken: "secret", target: "%3" })] },
] satisfies readonly OperationCase<"default", ResumeInput, PaneResumeState, EmptyContext>[];

const resumeTable: OperationTable<undefined, "default", ResumeInput, PaneResumeState, EmptyContext> = {
  defaultFixture: noFixture(),
  cases: resumeCases,
  execute: (_fixture, input) => resumeStateFromReady(input.message, input.target),
  observe: () => ({}),
};

type ControlFixture = {
  events: string[];
  resumed: boolean | null;
};
type ControlContext = { events: readonly string[]; resumed: boolean | null };
type ControlInput = { rawMessage: string };

const controlFixture = (): FixtureHandle<ControlFixture> => ({
  fixture: { events: [], resumed: null },
});

const controlCases = [
  {
    name: "keeps control frames separate and exposes the resumed ready state",
    input: { rawMessage: JSON.stringify(readyMessage) },
    assert: [
      hasObserved<ControlContext, undefined>("events", ["ready:terminal-1"]),
      hasObserved<ControlContext, undefined>("resumed", true),
    ],
  },
  {
    name: "reports invalid control data as non-retryable",
    input: { rawMessage: "not-json" },
    assert: [hasObserved<ControlContext, undefined>("events", ["error:invalid_control_frame:false"])],
  },
] satisfies readonly OperationCase<"default", ControlInput, undefined, ControlContext>[];

const controlTable: OperationTable<ControlFixture, "default", ControlInput, undefined, ControlContext> = {
  defaultFixture: controlFixture,
  cases: controlCases,
  execute: (fixture, input) => {
    handleControlMessage(input.rawMessage, {
      onReady: (message) => {
        fixture.resumed = message.resumed;
        fixture.events.push(`ready:${message.sessionId}`);
      },
      onClosed: (message) => fixture.events.push(`closed:${message.reason}`),
      onError: (message) => fixture.events.push(`error:${message.code}:${message.retryable}`),
      onViewport: (owner: PaneViewportOwner, reason: string) => fixture.events.push(`viewport:${owner}:${reason}`),
    });
  },
  observe: (fixture) => ({ events: [...fixture.events], resumed: fixture.resumed }),
};

describe("terminal pane handshake helpers", () => {
  const register = it as unknown as TestRegistrar;
  runOperationTable(register, attachTable);
  runOperationTable(register, resumeTable);
  runOperationTable(register, controlTable);
});
