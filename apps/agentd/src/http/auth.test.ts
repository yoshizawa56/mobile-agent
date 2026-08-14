import { describe, it } from "vitest";
import {
  hasObserved,
  runScenarioTable,
  type FixtureHandle,
  type ScenarioCase,
  type ScenarioTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { AuthStore, createAgentDatabase } from "@mobile-agent/persistence";
import { AuthService } from "../auth/service.js";
import { createAgentdApp, type AgentdHttpDependencies } from "./app.js";

type HttpStep = { type: "health" | "info" | "protected" | "preflight" };
type HttpFixture = {
  database: ReturnType<typeof createAgentDatabase>;
  app: ReturnType<typeof createAgentdApp>;
  statuses: Record<string, number>;
  origins: Record<string, string | null>;
};
type HttpContext = { statuses: Readonly<Record<string, number>>; origins: Readonly<Record<string, string | null>> };

const httpFixture = (): FixtureHandle<HttpFixture> => {
  const database = createAgentDatabase();
  const auth = new AuthService({ store: new AuthStore(database.sqlite), webOrigin: "http://web.example", agentdBaseUrl: "http://agentd.example" });
  const app = createAgentdApp({
    auth,
    corsOrigin: "http://web.example",
    hookToken: "hook",
    getTerminal: async () => ({ id: "terminal", name: "terminal", host: "host", tailnetIp: "100.64.0.1", state: "online", detail: "test", lastSeen: "now" }),
    listWorkspaceDirectories: async () => [],
    browseWorkspaceDirectories: async () => [],
    registerWorkspace: async () => { throw new Error("not used"); },
    resolveWorkspaceDirectory: async () => { throw new Error("not used"); },
    resolveWorkspaceSelection: async () => { throw new Error("not used"); },
    listSessions: async () => [],
    createSession: async () => { throw new Error("not used"); },
    listPanes: async () => [],
    createPane: async () => { throw new Error("not used"); },
    handleTmuxHook: () => undefined,
  } satisfies AgentdHttpDependencies);
  return { fixture: { database, app, statuses: {}, origins: {} }, cleanup: () => database.close() };
};

const cases = [
  {
    name: "keeps public endpoints public and protects the API",
    steps: [{ type: "health" }, { type: "info" }, { type: "protected" }, { type: "preflight" }],
    assert: [
      hasObserved<HttpContext, undefined>("statuses", { health: 200, info: 200, protected: 401, preflight: 204 }),
      hasObserved<HttpContext, undefined>("origins", { health: null, info: "http://web.example", protected: null, preflight: "http://web.example" }),
    ],
  },
] satisfies readonly ScenarioCase<"default", HttpStep, undefined, HttpContext>[];

const table: ScenarioTable<HttpFixture, "default", HttpStep, undefined, HttpContext> = {
  defaultFixture: httpFixture,
  cases,
  execute: async (fixture, steps) => {
    for (const step of steps) {
      let response: Response;
      if (step.type === "health") response = await fixture.app.request("http://agentd.example/health");
      else if (step.type === "info") response = await fixture.app.request(new Request("http://agentd.example/auth/v1/info", { headers: { origin: "http://web.example" } }));
      else if (step.type === "protected") response = await fixture.app.request("http://agentd.example/api/capabilities");
      else response = await fixture.app.request(new Request("http://agentd.example/api/capabilities", { method: "OPTIONS", headers: { origin: "http://web.example", "access-control-request-method": "GET" } }));
      fixture.statuses[step.type] = response.status;
      fixture.origins[step.type] = response.headers.get("access-control-allow-origin");
    }
  },
  observe: (fixture) => ({ statuses: { ...fixture.statuses }, origins: { ...fixture.origins } }),
};

describe("agentd HTTP authentication boundary", () => {
  runScenarioTable(it as unknown as TestRegistrar, table);
});
