import { describe, it } from "vitest";
import {
  hasObserved,
  runScenarioTable,
  type FixtureHandle,
  type ScenarioCase,
  type ScenarioTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { createAgentDatabase, AuthStore } from "@mobile-agent/persistence";
import { AgentdControlServer } from "./control.js";
import { AuthService } from "./service.js";

type ControlRequest = { agentSessionId: string; tmuxPaneId: string; executionId: string };
type ControlStep = { type: "adopt" | "release" };
type ControlFixture = {
  server: AgentdControlServer;
  handleRequest: (line: string) => void;
  request: ControlRequest;
  responses: string[];
  calls: string[];
  socket: { destroyed: boolean; write(data: string): void };
  database: ReturnType<typeof createAgentDatabase>;
};
type ControlContext = { responses: readonly unknown[]; calls: readonly string[] };

const request: ControlRequest = { agentSessionId: "session-id", tmuxPaneId: "%1", executionId: "execution-id-123456" };

const fixture = (): FixtureHandle<ControlFixture> => {
  const database = createAgentDatabase();
  const auth = new AuthService({
    store: new AuthStore(database.sqlite),
    agentdBaseUrl: "http://127.0.0.1:4317",
  });
  const calls: string[] = [];
  const responses: string[] = [];
  const server = new AgentdControlServer({
    socketPath: "/tmp/agentd-control-test.sock",
    auth,
    adoptAgentSession: async (input) => { calls.push("adopt:" + input.agentSessionId + ":" + input.tmuxPaneId + ":" + input.executionId); },
    releaseAgentSession: async (input) => { calls.push("release:" + input.agentSessionId + ":" + input.tmuxPaneId + ":" + input.executionId); },
  });
  const socket = {
    destroyed: false,
    write(data: string) { responses.push(data); },
  };
  const handleRequest = (server as unknown as {
    handleRequest: (client: typeof socket, line: string) => void;
  }).handleRequest.bind(server);
  return {
    fixture: { server, handleRequest: (line) => handleRequest(socket, line), request, responses, calls, socket, database },
    cleanup: () => { server.stop(); database.close(); },
  };
};

const cases = [
  {
    name: "dispatches pane adoption and release requests to the daemon",
    steps: [{ type: "adopt" }, { type: "release" }],
    assert: [
      hasObserved<ControlContext, undefined>("responses", [
        { type: "agent_session_adopted", ...request },
        { type: "agent_session_released", ...request },
      ]),
      hasObserved<ControlContext, undefined>("calls", [
        "adopt:session-id:%1:execution-id-123456",
        "release:session-id:%1:execution-id-123456",
      ]),
    ],
  },
] satisfies readonly ScenarioCase<"default", ControlStep, undefined, ControlContext>[];

const table: ScenarioTable<ControlFixture, "default", ControlStep, undefined, ControlContext> = {
  defaultFixture: fixture,
  cases,
  execute: async (testFixture, steps) => {
    for (const step of steps) {
      const type = step.type === "adopt" ? "adopt_agent_session" : "release_agent_session";
      const expectedCount = testFixture.responses.length + 1;
      testFixture.handleRequest(JSON.stringify({ type, ...testFixture.request }));
      await waitFor(() => testFixture.responses.length === expectedCount);
    }
  },
  observe: (testFixture) => ({
    responses: testFixture.responses.map((value) => JSON.parse(value)),
    calls: [...testFixture.calls],
  }),
};

describe("agentd private control socket", () => {
  runScenarioTable(it as unknown as TestRegistrar, table);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for agentd control response");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
