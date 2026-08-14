import { describe, expect, it } from "vitest";
import { createAgentDatabase, AuthStore } from "@mobile-agent/persistence";
import { AgentdControlServer } from "./control.js";
import { AuthService } from "./service.js";

describe("agentd private control socket", () => {
  it("dispatches pane adoption and release requests to the daemon", async () => {
    const database = createAgentDatabase();
    const socketPath = "/tmp/agentd-control-test.sock";
    const auth = new AuthService({
      store: new AuthStore(database.sqlite),
      webOrigin: "http://localhost:5173",
      agentdBaseUrl: "http://127.0.0.1:4317",
    });
    const calls: string[] = [];
    const request = { agentSessionId: "session-id", tmuxPaneId: "%1", executionId: "execution-id-123456" };
    const server = new AgentdControlServer({
      socketPath,
      auth,
      adoptAgentSession: async (input) => { calls.push(`adopt:${input.agentSessionId}:${input.tmuxPaneId}:${input.executionId}`); },
      releaseAgentSession: async (input) => { calls.push(`release:${input.agentSessionId}:${input.tmuxPaneId}:${input.executionId}`); },
    });
    const responses: string[] = [];
    const socket = {
      destroyed: false,
      write(data: string) {
        responses.push(data);
      },
    };
    const handleRequest = (server as unknown as {
      handleRequest: (client: typeof socket, line: string) => void;
    }).handleRequest.bind(server);

    try {
      handleRequest(socket, JSON.stringify({ type: "adopt_agent_session", ...request }));
      await waitFor(() => responses.length === 1);
      expect(JSON.parse(responses[0]!)).toEqual({ type: "agent_session_adopted", ...request });

      handleRequest(socket, JSON.stringify({ type: "release_agent_session", ...request }));
      await waitFor(() => responses.length === 2);
      expect(JSON.parse(responses[1]!)).toEqual({ type: "agent_session_released", ...request });

      expect(calls).toEqual([
        `adopt:${request.agentSessionId}:${request.tmuxPaneId}:${request.executionId}`,
        `release:${request.agentSessionId}:${request.tmuxPaneId}:${request.executionId}`,
      ]);
    } finally {
      server.stop();
      database.close();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for agentd control response");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
