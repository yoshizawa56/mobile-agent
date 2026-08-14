import { describe, expect, it } from "vitest";
import { agentdHealthSchema, paneListResponseSchema, sessionListResponseSchema, workspaceBrowseResponseSchema, workspaceListResponseSchema } from "@mobile-agent/protocol";
import { AgentdHttpError, createAgentdApp, type AgentdApp } from "./app.js";
import { InvalidWorkspaceDirectoryError } from "../workspace-selection.js";

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
  workspace: "mobile-agent",
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
  workspaceId: null,
  agentId: null,
  runId: null,
  state: "running" as const,
  title: null,
  lastSeenAt: "2026-08-10T00:00:00.000Z",
};

const workspace = {
  id: "workspace-1",
  name: "mobile-agent",
  directory: "/work/mobile-agent",
  isGit: true,
  setupScriptPath: null,
  cleanupScriptPath: null,
  worktreeCopyPatterns: [],
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
    name: "does not report health before the control server is ready",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events, { isReady: () => false });
      ctx.request = new Request("http://agentd.local/health");
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [(ctx) => expect(ctx.response?.status).toBe(503)],
    assert: [(ctx) => expect(ctx.body).toEqual({ error: "agentd_unavailable", message: "agentd is still starting" })],
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
    name: "lists allowed workspace directories through the injected catalog",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/api/workspaces");
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [
      (ctx) => expect(ctx.response?.status).toBe(200),
      (ctx) => expect(workspaceListResponseSchema.safeParse(ctx.body).success).toBe(true),
    ],
    assert: [(ctx) => expect(ctx.body).toEqual({ workspaces: [workspace] })],
  },
  {
    name: "browses host workspace directories through the injected catalog",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/api/workspace-directories");
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [
      (ctx) => expect(ctx.response?.status).toBe(200),
      (ctx) => expect(workspaceBrowseResponseSchema.safeParse(ctx.body).success).toBe(true),
    ],
    assert: [(ctx) => expect(ctx.body).toEqual({ directories: [workspace] })],
  },
  {
    name: "registers a workspace with host-side hook paths",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events, {
        registerWorkspace: async (input) => ({ ...workspace, setupScriptPath: input.setupScriptPath ?? null, cleanupScriptPath: input.cleanupScriptPath ?? null, worktreeCopyPatterns: input.worktreeCopyPatterns ?? [] }),
      });
      ctx.request = new Request("http://agentd.local/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: "/work/mobile-agent", setupScriptPath: "/Users/me/.config/agent/setup", cleanupScriptPath: null, worktreeCopyPatterns: [".env", "config/*.local.json"] }),
      });
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [(ctx) => expect(ctx.response?.status).toBe(201)],
    assert: [(ctx) => expect(ctx.body).toMatchObject({ workspace: { id: workspace.id, setupScriptPath: "/Users/me/.config/agent/setup", worktreeCopyPatterns: [".env", "config/*.local.json"] } })],
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
    name: "returns structured invalid-directory details for an unselectable workspace",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events, {
        resolveWorkspaceDirectory: async () => {
          throw new InvalidWorkspaceDirectoryError("/private/secret", "outside_allowed_root", ["/work"]);
        },
      });
      ctx.request = new Request("http://agentd.local/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "integration", workspaceId: "workspace-secret" }),
      });
    },
    when: async (ctx) => {
      ctx.response = await ctx.app!.request(ctx.request);
      ctx.body = await ctx.response.json();
    },
    check: [(ctx) => expect(ctx.response?.status).toBe(400)],
    assert: [(ctx) => expect(ctx.body).toEqual({
      error: "invalid_directory",
      message: "Directory is outside the allowed workspace roots: /private/secret",
      details: { directory: "/private/secret", reason: "outside_allowed_root", allowedRoots: ["/work"] },
    })],
  },
  {
    name: "resolves a workspace before creating a pane",
    given: (ctx) => {
      ctx.app = createTestApp(ctx.events);
      ctx.request = new Request("http://agentd.local/api/panes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionName: "integration",
          kind: "agent",
          name: "review",
          workspaceId: workspace.id,
          agentId: "codex",
          useWorktree: true,
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
    assert: [(ctx) => expect(ctx.body).toMatchObject({ pane: { tmuxPaneId: "%0" } })],
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
    allowUnauthenticated: true,
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
    listWorkspaceDirectories: async () => [workspace],
    browseWorkspaceDirectories: async () => [workspace],
    registerWorkspace: async () => workspace,
    resolveWorkspaceDirectory: async (workspaceId) => ({ id: workspaceId, rootPath: workspace.directory, name: workspace.name, isGit: workspace.isGit, setupScriptPath: workspace.setupScriptPath, cleanupScriptPath: workspace.cleanupScriptPath, worktreeCopyPatterns: workspace.worktreeCopyPatterns, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" }),
    resolveWorkspaceSelection: async (selection) => ({
      id: selection.workspaceId,
      rootPath: workspace.directory,
      name: workspace.name,
      isGit: workspace.isGit,
      setupScriptPath: workspace.setupScriptPath,
      cleanupScriptPath: workspace.cleanupScriptPath,
      worktreeCopyPatterns: workspace.worktreeCopyPatterns,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
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
