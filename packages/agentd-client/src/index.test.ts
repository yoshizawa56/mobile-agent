import { describe, it } from "vitest";
import {
  hasError,
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
  createAgentdClient,
  createSameOriginConnection,
  createServeConnection,
  type AgentdConnection,
} from "./index.js";

type QueryContext = { requests: readonly string[] };
type QueryOperation = "sessions" | "panes" | "workspaces" | "browse-workspaces" | "invalid-session";
type QueryInput = { operation: QueryOperation; requestPath: string; response: unknown };

type QueryFixture = {
  requests: string[];
  response: unknown;
};

const queryFixture = (): FixtureHandle<QueryFixture> => {
  const originalFetch = globalThis.fetch;
  const fixture: QueryFixture = { requests: [], response: null };
  return {
    fixture,
    cleanup: () => { globalThis.fetch = originalFetch; },
  };
};

const queryCases = [
  {
    name: "reads sessions through the typed RPC path",
    input: {
      operation: "sessions",
      requestPath: "/api/sessions",
      response: { sessions: [{ name: "integration", paneCount: 1, waitingCount: 0, detail: "0 agents · 1 shell" }] },
    },
    assert: [
      returns<QueryContext, unknown>([{ name: "integration", paneCount: 1, waitingCount: 0, detail: "0 agents · 1 shell" }]),
      hasObserved<QueryContext, unknown>("requests", ["http://agentd.local/api/sessions"]),
    ],
  },
  {
    name: "reads pane summaries through the typed query path",
    input: { operation: "panes", requestPath: "/api/panes?session=integration", response: { panes: [] } },
    assert: [
      returns<QueryContext, unknown>([]),
      hasObserved<QueryContext, unknown>("requests", ["http://agentd.local/api/panes?session=integration"]),
    ],
  },
  {
    name: "reads allowed workspaces through the typed query path",
    input: {
      operation: "workspaces",
      requestPath: "/api/workspaces",
      response: { workspaces: [{ id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] }] },
    },
    assert: [
      returns<QueryContext, unknown>([{ id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] }]),
      hasObserved<QueryContext, unknown>("requests", ["http://agentd.local/api/workspaces"]),
    ],
  },
  {
    name: "browses host directories through the typed query path",
    input: {
      operation: "browse-workspaces",
      requestPath: "/api/workspace-directories",
      response: { directories: [{ id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] }] },
    },
    assert: [
      returns<QueryContext, unknown>([{ id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] }]),
      hasObserved<QueryContext, unknown>("requests", ["http://agentd.local/api/workspace-directories?"]),
    ],
  },
  {
    name: "preserves structured directory errors from agentd",
    input: {
      operation: "invalid-session",
      requestPath: "/api/sessions",
      response: { error: "invalid_directory", message: "Directory is outside the allowed workspace roots", details: { directory: "/private/secret", reason: "outside_allowed_root", allowedRoots: ["/work"] } },
    },
    assert: [
      hasError<QueryContext, unknown>({ code: "invalid_directory", message: "Directory is outside the allowed workspace roots", details: { reason: "outside_allowed_root" } }),
      hasObserved<QueryContext, unknown>("requests", ["http://agentd.local/api/sessions"]),
    ],
  },
] satisfies readonly OperationCase<"default", QueryInput, unknown, QueryContext>[];

const queryTable: OperationTable<QueryFixture, "default", QueryInput, unknown, QueryContext> = {
  defaultFixture: queryFixture,
  cases: queryCases,
  execute: async (fixture, input) => {
    fixture.response = input.response;
    globalThis.fetch = async (request: RequestInfo | URL) => {
      fixture.requests.push(String(request));
      return new Response(JSON.stringify(fixture.response), { status: input.operation === "invalid-session" ? 400 : 200, headers: { "content-type": "application/json" } });
    };
    const client = createAgentdClient({ httpBaseUrl: "http://agentd.local", websocketUrl: "ws://agentd.local/terminal" });
    if (input.operation === "sessions" || input.operation === "invalid-session") return client.sessions();
    if (input.operation === "panes") return client.panes("integration");
    if (input.operation === "workspaces") return client.workspaces();
    return client.browseWorkspaces();
  },
  observe: (fixture) => ({ requests: [...fixture.requests] }),
};

type MutationRequest = { method: string; url: string; body: unknown };
type MutationContext = { requests: readonly MutationRequest[] };
type MutationFixture = { requests: MutationRequest[] };
type MutationInput =
  | { kind: "update"; workspaceId: string; input: { name: string }; response: unknown }
  | { kind: "delete"; workspaceId: string; response: null };

const mutationFixture = (): FixtureHandle<MutationFixture> => {
  const originalFetch = globalThis.fetch;
  return { fixture: { requests: [] }, cleanup: () => { globalThis.fetch = originalFetch; } };
};

const mutationCases = [
  {
    name: "updates a workspace through the typed RPC path",
    input: {
      kind: "update",
      workspaceId: "workspace-1",
      input: { name: "renamed" },
      response: { id: "workspace-1", name: "renamed", directory: "/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] },
    },
    assert: [
      returns<MutationContext, unknown>({ id: "workspace-1", name: "renamed", directory: "/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] }),
      hasObserved<MutationContext, unknown>("requests", [{ method: "PATCH", url: "http://agentd.local/api/workspaces/workspace-1", body: { name: "renamed" } }]),
    ],
  },
  {
    name: "deletes a workspace through the typed RPC path",
    input: { kind: "delete", workspaceId: "workspace-1", response: null },
    assert: [
      returns<MutationContext, unknown>(undefined),
      hasObserved<MutationContext, unknown>("requests", [{ method: "DELETE", url: "http://agentd.local/api/workspaces/workspace-1", body: null }]),
    ],
  },
] satisfies readonly OperationCase<"default", MutationInput, unknown, MutationContext>[];

const mutationTable: OperationTable<MutationFixture, "default", MutationInput, unknown, MutationContext> = {
  defaultFixture: mutationFixture,
  cases: mutationCases,
  execute: async (fixture, input) => {
    globalThis.fetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(requestInput, init);
      fixture.requests.push({ method: request.method, url: request.url, body: request.method === "PATCH" ? await request.clone().json() : null });
      return new Response(input.kind === "delete" ? null : JSON.stringify({ workspace: input.response }), {
        status: input.kind === "delete" ? 204 : 200,
        headers: input.kind === "delete" ? undefined : { "content-type": "application/json" },
      });
    };
    const client = createAgentdClient({ httpBaseUrl: "http://agentd.local", websocketUrl: "ws://agentd.local/terminal" });
    return input.kind === "update" ? client.updateWorkspace(input.workspaceId, input.input) : client.deleteWorkspace(input.workspaceId);
  },
  observe: (fixture) => ({ requests: [...fixture.requests] }),
};

type RouteInput = { kind: "serve" | "same-origin"; url: string };
const routeCases = [
  {
    name: "builds a Serve HTTPS and WSS pair",
    input: { kind: "serve", url: "https://workstation.tailnet.ts.net/" },
    assert: [returns<{}, AgentdConnection>({ httpBaseUrl: "https://workstation.tailnet.ts.net", websocketUrl: "wss://workstation.tailnet.ts.net/terminal", eventsWebsocketUrl: "wss://workstation.tailnet.ts.net/events", route: "serve" })],
  },
  {
    name: "preserves a reverse proxy path",
    input: { kind: "serve", url: "https://example.test/agentd/" },
    assert: [returns<{}, AgentdConnection>({ httpBaseUrl: "https://example.test/agentd", websocketUrl: "wss://example.test/agentd/terminal", eventsWebsocketUrl: "wss://example.test/agentd/events", route: "serve" })],
  },
  {
    name: "builds a same-origin development route",
    input: { kind: "same-origin", url: "http://localhost:5173" },
    assert: [returns<{}, AgentdConnection>({ httpBaseUrl: "http://localhost:5173", websocketUrl: "ws://localhost:5173/terminal", eventsWebsocketUrl: "ws://localhost:5173/events", route: "same-origin" })],
  },
  {
    name: "rejects a non-http route URL",
    input: { kind: "serve", url: "ssh://workstation" },
    assert: [hasError<{}, AgentdConnection>({ message: /^agentd URL must use http or https/ })],
  },
] satisfies readonly OperationCase<"default", RouteInput, AgentdConnection, {}>[];

const routeTable: OperationTable<undefined, "default", RouteInput, AgentdConnection, {}> = {
  defaultFixture: noFixture(),
  cases: routeCases,
  execute: (_fixture, input) => input.kind === "serve" ? createServeConnection(input.url) : createSameOriginConnection(input.url),
  observe: () => ({}),
};

describe("agentd RPC client", () => {
  const register = it as unknown as TestRegistrar;
  runOperationTable(register, queryTable);
  runOperationTable(register, mutationTable);
  runOperationTable(register, routeTable);
});
