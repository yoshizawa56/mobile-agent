import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentdClient, createSameOriginConnection, createServeConnection } from "./index.js";

describe("agentd RPC client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      name: "reads sessions through the typed RPC path",
      requestPath: "/api/sessions",
      response: { sessions: [{ name: "integration", project: "mobile-agent", cwd: "~", paneCount: 1, waitingCount: 0, detail: "0 agents · 1 shell", state: "active" }] },
      read: async (client: ReturnType<typeof createAgentdClient>) => client.sessions(),
      assert: (value: unknown) => expect(value).toMatchObject([{ name: "integration" }]),
    },
    {
      name: "reads pane summaries through the typed query path",
      requestPath: "/api/panes?session=integration",
      response: { panes: [] },
      read: async (client: ReturnType<typeof createAgentdClient>) => client.panes("integration"),
      assert: (value: unknown) => expect(value).toEqual([]),
    },
  ])("$name", async ({ requestPath, response, read, assert }) => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = createAgentdClient({
      httpBaseUrl: "http://agentd.local",
      websocketUrl: "ws://agentd.local/terminal",
    });
    const value = await read(client);

    expect(requests[0]).toContain(requestPath);
    assert(value);
  });

  it("creates a pane through the typed RPC path", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        pane: {
          id: "pane-2",
          tmuxPaneId: "%2",
          sessionName: "integration",
          windowId: "@0",
          kind: "agent",
          name: "review",
          cwd: "/tmp",
          projectId: null,
          workspaceId: null,
          agentId: "codex",
          runId: null,
          state: "starting",
          title: null,
          lastSeenAt: "2026-08-10T00:00:00.000Z",
        },
      }), { status: 201, headers: { "content-type": "application/json" } });
    });

    const client = createAgentdClient({ httpBaseUrl: "http://agentd.local", websocketUrl: "ws://agentd.local/terminal" });
    const pane = await client.createPane({
      sessionName: "integration",
      kind: "agent",
      name: "review",
      cwd: "/tmp",
      agentId: "codex",
      useWorktree: false,
      projectName: null,
      placement: "window",
      targetPaneId: null,
    });

    expect(requests[0]).toContain("/api/panes");
    expect(pane).toMatchObject({ name: "review", agentId: "codex" });
  });
});

describe("agentd route helpers", () => {
  it.each([
    {
      name: "builds a Serve HTTPS and WSS pair",
      input: "https://workstation.tailnet.ts.net/",
      expected: {
        httpBaseUrl: "https://workstation.tailnet.ts.net",
        websocketUrl: "wss://workstation.tailnet.ts.net/terminal",
        eventsWebsocketUrl: "wss://workstation.tailnet.ts.net/events",
        route: "serve",
      },
      create: createServeConnection,
    },
    {
      name: "preserves a reverse proxy path",
      input: "https://example.test/agentd/",
      expected: {
        httpBaseUrl: "https://example.test/agentd",
        websocketUrl: "wss://example.test/agentd/terminal",
        eventsWebsocketUrl: "wss://example.test/agentd/events",
        route: "serve",
      },
      create: createServeConnection,
    },
    {
      name: "builds a same-origin development route",
      input: "http://localhost:5173",
      expected: {
        httpBaseUrl: "http://localhost:5173",
        websocketUrl: "ws://localhost:5173/terminal",
        eventsWebsocketUrl: "ws://localhost:5173/events",
        route: "same-origin",
      },
      create: createSameOriginConnection,
    },
  ])("$name", ({ input, expected, create }) => {
    expect(create(input)).toEqual(expected);
  });

  it("rejects a non-http route URL", () => {
    expect(() => createServeConnection("ssh://workstation"))
      .toThrow("agentd URL must use http or https");
  });
});
