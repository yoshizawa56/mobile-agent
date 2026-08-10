import { describe, expect, it } from "vitest";
import { agentdHealthSchema, paneListResponseSchema, sessionListResponseSchema } from "@mobile-agent/protocol";
import { AgentdHttpError, createAgentdApp, type AgentdApp } from "./app.js";

type TestContext = {
  app?: AgentdApp;
  request: Request;
  response?: Response;
  body?: unknown;
  events: Array<{ event: string; client: string }>;
};

type TableCase = {
  name: string;
  given: (ctx: TestContext) => void;
  when: (ctx: TestContext) => Promise<void>;
  check: Array<(ctx: TestContext) => void>;
  assert: Array<(ctx: TestContext) => void>;
};

const session = {
  name: "integration",
  project: "mobile-agent",
  cwd: "~/work/mobile-agent",
  paneCount: 1,
  waitingCount: 0,
  detail: "0 agents · 1 shell",
  state: "active" as const,
};

const pane = {
  id: "pane-1",
  tmuxPaneId: "%0",
  sessionName: "integration",
  windowId: "@0",
  kind: "shell" as const,
  name: "shell",
  cwd: "/tmp",
  projectId: null,
  workspaceId: null,
  agentId: null,
  runId: null,
  state: "running" as const,
  title: null,
  lastSeenAt: "2026-08-10T00:00:00.000Z",
};

const cases: TableCase[] = [
  {
    name: "returns a typed health response",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/health");
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [
      (ctx) => expect(ctx.response?.status).toBe(200),
      (ctx) => expect(agentdHealthSchema.safeParse(ctx.body).success).toBe(true),
    ],
    assert: [(ctx) => expect(ctx.body).toMatchObject({ service: "agentd", protocolVersion: 1 })],
  },
  {
    name: "lists sessions through the injected use case",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/api/sessions");
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [
      (ctx) => expect(ctx.response?.status).toBe(200),
      (ctx) => expect(sessionListResponseSchema.safeParse(ctx.body).success).toBe(true),
    ],
    assert: [(ctx) => expect(ctx.body).toMatchObject({ sessions: [{ name: "integration" }] })],
  },
  {
    name: "filters panes with the session query",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/api/panes?session=integration");
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [
      (ctx) => expect(ctx.response?.status).toBe(200),
      (ctx) => expect(paneListResponseSchema.safeParse(ctx.body).success).toBe(true),
    ],
    assert: [(ctx) => expect(ctx.body).toMatchObject({ panes: [{ tmuxPaneId: "%0" }] })],
  },
  {
    name: "returns a domain error from session creation",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events, {
        createSession: async () => {
          throw new AgentdHttpError(409, "session_exists", "tmux session already exists: integration");
        },
      });
      ctx.request = new Request("http://agentd.local/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "integration", cwd: "/tmp" }),
      });
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [(ctx) => expect(ctx.response?.status).toBe(409)],
    assert: [(ctx) => expect(ctx.body).toEqual({ error: "session_exists", message: "tmux session already exists: integration" })],
  },
  {
    name: "creates a pane through the injected pane use case",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/api/panes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionName: "integration",
          kind: "agent",
          name: "review",
          cwd: "/tmp",
          agentId: "codex",
          useWorktree: false,
          projectName: null,
          placement: "window",
          targetPaneId: null,
        }),
      });
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [(ctx) => expect(ctx.response?.status).toBe(201)],
    assert: [(ctx) => expect(ctx.body).toMatchObject({ pane: { tmuxPaneId: "%0", name: "shell" } })],
  },
  {
    name: "accepts a signed tmux hook and forwards it to the viewport service",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/internal/tmux-hook", {
        method: "POST",
        headers: { "x-agentd-hook-token": "test-token", "content-type": "application/x-www-form-urlencoded" },
        body: "event=client-active&client=%2Fdev%2Fdesktop",
      });
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
    },
    check: [(ctx) => expect(ctx.response?.status).toBe(204)],
    assert: [(ctx) => expect(ctx.events).toEqual([{ event: "client-active", client: "/dev/desktop" }])],
  },
];

describe("agentd HTTP app", () => {
  it.each(cases)("$name", async ({ given, when, check, assert }) => {
    const ctx: TestContext = {
      request: new Request("http://agentd.local/"),
      events: [],
    };
    given(ctx);
    await when(ctx);
    check.forEach((checkCase) => checkCase(ctx));
    assert.forEach((assertCase) => assertCase(ctx));
  });
});

function createTestApp(
  events: Array<{ event: string; client: string }>,
  overrides: Partial<Parameters<typeof createAgentdApp>[0]> = {},
): AgentdApp {
  const app = createAgentdApp({
    corsOrigin: "*",
    hookToken: "test-token",
    getTerminal: async () => ({
      id: "mac",
      name: "Mac",
      host: "mac.local",
      tailnetIp: "100.64.0.1",
      state: "online",
      detail: "agentd · darwin",
      lastSeen: "online now",
    }),
    listSessions: async () => [session],
    createSession: async () => session,
    listPanes: async () => [pane],
    createPane: async () => pane,
    handleTmuxHook: (event, client) => events.push({ event, client }),
    ...overrides,
  });

  return app;
}
