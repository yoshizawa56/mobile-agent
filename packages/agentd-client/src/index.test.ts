import { afterEach, describe, expect, it } from "vitest";
import { createAgentdClient, createSameOriginConnection, createServeConnection } from "./index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("agentd RPC client", () => {
  it.each([
    {
      name: "reads sessions through the typed RPC path",
      requestPath: "/api/sessions",
      response: { sessions: [{ name: "integration", workspace: "mobile-agent", cwd: "~", paneCount: 1, waitingCount: 0, detail: "0 agents · 1 shell", state: "active" }] },
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
    {
      name: "reads allowed workspaces through the typed query path",
      requestPath: "/api/workspaces",
      response: { workspaces: [{ id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null }] },
      read: async (client: ReturnType<typeof createAgentdClient>) => client.workspaces(),
      assert: (value: unknown) => expect(value).toMatchObject([{ id: "workspace-1" }]),
    },
    {
      name: "browses host directories through the typed query path",
      requestPath: "/api/workspace-directories",
      response: { directories: [{ id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null }] },
      read: async (client: ReturnType<typeof createAgentdClient>) => client.browseWorkspaces(),
      assert: (value: unknown) => expect(value).toMatchObject([{ name: "mobile-agent" }]),
    },
  ])("$name", async ({ requestPath, response, read, assert }) => {
    const requests: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    };

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
    globalThis.fetch = async (input: RequestInfo | URL) => {
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
          workspaceId: null,
          agentId: "codex",
          runId: null,
          state: "starting",
          title: null,
          lastSeenAt: "2026-08-10T00:00:00.000Z",
        },
      }), { status: 201, headers: { "content-type": "application/json" } });
    };

    const client = createAgentdClient({ httpBaseUrl: "http://agentd.local", websocketUrl: "ws://agentd.local/terminal" });
    const pane = await client.createPane({
      sessionName: "integration",
      kind: "agent",
      name: "review",
      workspaceId: "workspace-1",
      agentId: "codex",
      useWorktree: false,
      placement: "window",
      targetPaneId: null,
    });

    expect(requests[0]).toContain("/api/panes");
    expect(pane).toMatchObject({ name: "review", agentId: "codex" });
  });

  it("preserves structured directory errors from agentd", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: "invalid_directory",
      message: "Directory is outside the allowed workspace roots",
      details: { directory: "/private/secret", reason: "outside_allowed_root", allowedRoots: ["/work"] },
    }), { status: 400, headers: { "content-type": "application/json" } });

    const client = createAgentdClient({ httpBaseUrl: "http://agentd.local", websocketUrl: "ws://agentd.local/terminal" });
    await expect(client.createSession({ name: "review", workspaceId: "workspace-secret" })).rejects.toMatchObject({
      name: "AgentdApiError",
      status: 400,
      code: "invalid_directory",
      details: { reason: "outside_allowed_root" },
    });
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
