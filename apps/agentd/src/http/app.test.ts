import { describe, expect, it } from "vitest";
import { ApplicationError } from "@mobile-agent/application";
import { agentdHealthSchema, paneListResponseSchema, sessionListResponseSchema, workspaceBrowseResponseSchema, workspaceListResponseSchema } from "@mobile-agent/protocol";
import {
  runOperationTable,
  hasObserved,
  type Assertion,
  type FixtureHandle,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { createAgentdApp, type AgentdApp, type AgentdAuthPort } from "./app.js";
import { InvalidWorkspaceDirectoryError } from "../workspace-selection.js";

const session = { name: "integration", workspace: "mobile-agent", cwd: "~/work/mobile-agent", paneCount: 1, waitingCount: 0, detail: "0 agents · 1 shell", state: "active" as const };
const pane = { id: "pane-1", tmuxPaneId: "%0", sessionName: "integration", windowId: "@0", kind: "shell" as const, name: "shell", cwd: "/tmp", workspaceId: null, agentId: null, runId: null, state: "running" as const, title: null, lastSeenAt: "2026-08-10T00:00:00.000Z" };
const workspace = { id: "workspace-1", name: "mobile-agent", directory: "/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] };
const testAuthContext = {
  sessionId: "session-test-000000000000",
  serverId: "server-test-000000000000",
  deviceId: "device-test-000000000000",
  issuedAt: "2026-08-10T00:00:00.000Z",
  expiresAt: "2099-08-10T00:00:00.000Z",
  revokedAt: null,
  device: {
    deviceId: "device-test-000000000000",
    serverId: "server-test-000000000000",
    publicKeyJwk: "{}",
    keyFingerprint: "fingerprint-test",
    displayName: "test",
    deviceType: "browser" as const,
    platform: null,
    clientVersion: null,
    status: "active" as const,
    createdAt: "2026-08-10T00:00:00.000Z",
    approvedAt: "2026-08-10T00:00:00.000Z",
    lastSeenAt: null,
    revokedAt: null,
  },
};
const testAuth: AgentdAuthPort = {
  serverId: testAuthContext.serverId,
  allowsWebOrigin: () => true,
  authenticateAccessToken: () => testAuthContext,
  claimPairing: () => { throw new Error("not used"); },
  pairingStatus: () => { throw new Error("not used"); },
  createChallenge: () => { throw new Error("not used"); },
  createSession: () => { throw new Error("not used"); },
  issueWebSocketTicket: () => { throw new Error("not used"); },
  consumeWebSocketTicket: () => null,
};

type RequestInput = { url: string; method?: string; headers?: HeadersInit; body?: string };
type HttpResult = { status: number; body: unknown };
type HttpContext = { events: readonly { event: string; client: string }[] };
type AppKey = "default" | "not-ready" | "register" | "session-error" | "directory-error";
type AppFixture = { app: AgentdApp; events: Array<{ event: string; client: string }> };
const jsonHeaders: HeadersInit = { "content-type": "application/json" };
const hookHeaders: HeadersInit = { "x-agentd-hook-token": "test-token", "content-type": "application/x-www-form-urlencoded" };

const responseMatches = (status: number, expectedBody?: unknown, schema?: { safeParse: (value: unknown) => { success: boolean } }): Assertion<HttpContext, HttpResult> => ({
  name: `returns HTTP ${status}`,
  check: (_ctx, result) => {
    if (!result.ok) throw result.error;
    expect(result.value.status).toBe(status);
    if (schema) expect(schema.safeParse(result.value.body).success).toBe(true);
    if (expectedBody !== undefined) expect(result.value.body).toMatchObject(expectedBody as object);
  },
});

const exactResponse = (status: number, body: unknown): Assertion<HttpContext, HttpResult> => ({
  name: `returns exact HTTP ${status} response`,
  check: (_ctx, result) => {
    if (!result.ok) throw result.error;
    expect(result.value.status).toBe(status);
    expect(result.value.body).toEqual(body);
  },
});

const appFixture = (kind: AppKey): (() => FixtureHandle<AppFixture>) => () => {
  const events: Array<{ event: string; client: string }> = [];
  const overrides = kind === "not-ready"
    ? { isReady: () => false }
    : kind === "register"
      ? { application: { workspaces: { register: async (input: { setupScriptPath?: string | null; cleanupScriptPath?: string | null; worktreeCopyPatterns?: string[] }) => ({ ...workspace, setupScriptPath: input.setupScriptPath ?? null, cleanupScriptPath: input.cleanupScriptPath ?? null, worktreeCopyPatterns: input.worktreeCopyPatterns ?? [] }) } } }
      : kind === "session-error"
        ? { application: { sessions: { create: async () => { throw new ApplicationError("session_exists", "tmux session already exists: integration"); } } } }
        : kind === "directory-error"
          ? { application: { workspaces: { resolveDirectory: async () => { throw new InvalidWorkspaceDirectoryError("/private/secret", "outside_allowed_root", ["/work"]); } } } }
          : {};
  return { fixture: { app: createTestApp(events, overrides), events } };
};

const cases = [
  { name: "returns a typed health response", input: { url: "http://agentd.local/health" }, assert: [responseMatches(200, { service: "agentd", protocolVersion: 1 }, agentdHealthSchema)] },
  { name: "does not report health before the control server is ready", fixture: "not-ready", input: { url: "http://agentd.local/health" }, assert: [exactResponse(503, { error: "agentd_unavailable", message: "agentd is still starting" })] },
  { name: "lists sessions through the injected use case", input: { url: "http://agentd.local/api/sessions" }, assert: [responseMatches(200, { sessions: [{ name: "integration" }] }, sessionListResponseSchema)] },
  { name: "lists allowed workspace directories through the injected catalog", input: { url: "http://agentd.local/api/workspaces" }, assert: [responseMatches(200, { workspaces: [workspace] }, workspaceListResponseSchema)] },
  { name: "browses host workspace directories through the injected catalog", input: { url: "http://agentd.local/api/workspace-directories" }, assert: [responseMatches(200, { directories: [workspace] }, workspaceBrowseResponseSchema)] },
  {
    name: "registers a workspace with host-side hook paths",
    fixture: "register",
    input: { url: "http://agentd.local/api/workspaces", method: "POST", headers: jsonHeaders, body: JSON.stringify({ directory: "/work/mobile-agent", setupScriptPath: "/Users/me/.config/agent/setup", cleanupScriptPath: null, worktreeCopyPatterns: [".env", "config/*.local.json"] }) },
    assert: [responseMatches(201, { workspace: { id: workspace.id, setupScriptPath: "/Users/me/.config/agent/setup", worktreeCopyPatterns: [".env", "config/*.local.json"] } })],
  },
  { name: "filters panes with the session query", input: { url: "http://agentd.local/api/panes?session=integration" }, assert: [responseMatches(200, { panes: [{ tmuxPaneId: "%0" }] }, paneListResponseSchema)] },
  { name: "returns the shared validation error for invalid request JSON", input: { url: "http://agentd.local/api/sessions", method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "", cwd: "/tmp" }) }, assert: [responseMatches(400, { error: "invalid_request" })] },
  { name: "returns the shared error shape for an unknown route", input: { url: "http://agentd.local/api/does-not-exist" }, assert: [exactResponse(404, { error: "not_found", message: "Route not found" })] },
  {
    name: "returns a domain error from session creation",
    fixture: "session-error",
    input: { url: "http://agentd.local/api/sessions", method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "integration", cwd: "/tmp" }) },
    assert: [exactResponse(409, { error: "session_exists", message: "tmux session already exists: integration" })],
  },
  {
    name: "returns structured invalid-directory details for an unselectable workspace",
    fixture: "directory-error",
    input: { url: "http://agentd.local/api/sessions", method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "integration", workspaceId: "workspace-secret" }) },
    assert: [exactResponse(400, { error: "invalid_directory", message: "Directory is outside the allowed workspace roots: /private/secret", details: { directory: "/private/secret", reason: "outside_allowed_root", allowedRoots: ["/work"] } })],
  },
  {
    name: "resolves a workspace before creating a pane",
    input: { url: "http://agentd.local/api/panes", method: "POST", headers: jsonHeaders, body: JSON.stringify({ sessionName: "integration", kind: "agent", name: "review", workspaceId: workspace.id, agentId: "codex", useWorktree: true, placement: "window", targetPaneId: null }) },
    assert: [responseMatches(201, { pane: { tmuxPaneId: "%0" } })],
  },
  {
    name: "creates a pane through the injected pane use case",
    input: { url: "http://agentd.local/api/panes", method: "POST", headers: jsonHeaders, body: JSON.stringify({ sessionName: "integration", kind: "agent", name: "review", cwd: "/tmp", agentId: "codex", useWorktree: false, placement: "window", targetPaneId: null }) },
    assert: [responseMatches(201, { pane: { tmuxPaneId: "%0", name: "shell" } })],
  },
  {
    name: "accepts a signed tmux hook and forwards it to the viewport service",
    input: { url: "http://agentd.local/internal/tmux-hook", method: "POST", headers: hookHeaders, body: "event=client-active&client=%2Fdev%2Fdesktop" },
    assert: [responseMatches(204), hasObserved<HttpContext, HttpResult>("events", [{ event: "client-active", client: "/dev/desktop" }])],
  },
] satisfies readonly OperationCase<AppKey, RequestInput, HttpResult, HttpContext>[];

const table: OperationTable<AppFixture, AppKey, RequestInput, HttpResult, HttpContext> = {
  defaultFixture: appFixture("default"),
  fixtures: { default: appFixture("default"), "not-ready": appFixture("not-ready"), register: appFixture("register"), "session-error": appFixture("session-error"), "directory-error": appFixture("directory-error") },
  cases,
  execute: async (fixture, input) => {
    const headers = new Headers(input.headers);
    if (!headers.has("authorization")) headers.set("authorization", "Bearer test-token");
    const response = await fixture.app.request(new Request(input.url, { method: input.method, headers, body: input.body }));
    const body = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  },
  observe: (fixture) => ({ events: [...fixture.events] }),
};

describe("agentd HTTP app", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});

type AgentdDependencies = Parameters<typeof createAgentdApp>[0];
type AgentdApplication = AgentdDependencies["application"];
type ApplicationOverrides = {
  terminal?: Partial<AgentdApplication["terminal"]>;
  workspaces?: Partial<AgentdApplication["workspaces"]>;
  sessions?: Partial<AgentdApplication["sessions"]>;
  panes?: Partial<AgentdApplication["panes"]>;
  hooks?: Partial<AgentdApplication["hooks"]>;
};

type AppOverrides = Omit<Partial<Parameters<typeof createAgentdApp>[0]>, "application"> & { application?: ApplicationOverrides };

function createTestApp(events: Array<{ event: string; client: string }>, overrides: AppOverrides = {}): AgentdApp {
  const application = {
    terminal: { get: async () => ({ id: "mac", name: "Mac", host: "mac.local", tailnetIp: "100.64.0.1", state: "online" as const, detail: "agentd · darwin", lastSeen: "online now" }) },
    workspaces: {
      list: async () => [workspace],
      browse: async () => [workspace],
      register: async () => workspace,
      resolveDirectory: async (workspaceId: string) => ({ id: workspaceId, rootPath: workspace.directory, name: workspace.name, isGit: workspace.isGit, setupScriptPath: workspace.setupScriptPath, cleanupScriptPath: workspace.cleanupScriptPath, worktreeCopyPatterns: workspace.worktreeCopyPatterns, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" }),
      resolveSelection: async (selection: { workspaceId: string }) => ({ id: selection.workspaceId, rootPath: workspace.directory, name: workspace.name, isGit: workspace.isGit, setupScriptPath: workspace.setupScriptPath, cleanupScriptPath: workspace.cleanupScriptPath, worktreeCopyPatterns: workspace.worktreeCopyPatterns, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" }),
    },
    sessions: { list: async () => [session], create: async () => session },
    panes: { list: async () => [pane], create: async () => pane },
    hooks: { handleTmux: (event: string, client: string) => events.push({ event, client }) },
  };
  const applicationOverrides = overrides.application;
  return createAgentdApp({
    ...overrides,
    auth: testAuth,
    application: {
      ...application,
      ...applicationOverrides,
      terminal: { ...application.terminal, ...applicationOverrides?.terminal },
      workspaces: { ...application.workspaces, ...applicationOverrides?.workspaces },
      sessions: { ...application.sessions, ...applicationOverrides?.sessions },
      panes: { ...application.panes, ...applicationOverrides?.panes },
      hooks: { ...application.hooks, ...applicationOverrides?.hooks },
    },
    corsOrigin: "*",
    hookToken: "test-token",
  });
}
