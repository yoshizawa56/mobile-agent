import { describe, expect, it } from "vitest";
import { AuthStore, createAgentDatabase } from "@mobile-agent/persistence";
import { AuthService } from "../auth/service.js";
import { createAgentdApp, type AgentdHttpDependencies } from "./app.js";

describe("agentd HTTP authentication boundary", () => {
  it("keeps health and auth info public while protecting the API and allowing CORS preflight", async () => {
    const database = createAgentDatabase();
    try {
      const auth = new AuthService({
        store: new AuthStore(database.sqlite),
        webOrigin: "http://web.example",
        agentdBaseUrl: "http://agentd.example",
      });
      const app = createAgentdApp({
        auth,
        corsOrigin: "http://web.example",
        hookToken: "hook",
        getTerminal: async () => ({ id: "terminal", name: "terminal", host: "host", tailnetIp: "100.64.0.1", state: "online", detail: "test", lastSeen: "now" }),
        listWorkspaceDirectories: async () => [],
        browseWorkspaceDirectories: async () => [],
        registerWorkspace: async () => { throw new Error("not used"); },
        updateWorkspace: async () => { throw new Error("not used"); },
        deleteWorkspace: async () => { throw new Error("not used"); },
        resolveWorkspaceDirectory: async () => { throw new Error("not used"); },
        resolveWorkspaceSelection: async () => { throw new Error("not used"); },
        listSessions: async () => [],
        createSession: async () => { throw new Error("not used"); },
        listPanes: async () => [],
        createPane: async () => { throw new Error("not used"); },
        handleTmuxHook: () => undefined,
      } satisfies AgentdHttpDependencies);

      const health = await app.request("http://agentd.example/health");
      expect(health.status).toBe(200);
      const info = await app.request(new Request("http://agentd.example/auth/v1/info", { headers: { origin: "http://web.example" } }));
      expect(info.status).toBe(200);
      expect(info.headers.get("access-control-allow-origin")).toBe("http://web.example");
      expect((await app.request("http://agentd.example/api/capabilities")).status).toBe(401);

      const preflight = await app.request(new Request("http://agentd.example/api/capabilities", {
        method: "OPTIONS",
        headers: { origin: "http://web.example", "access-control-request-method": "GET" },
      }));
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("http://web.example");
    } finally {
      database.close();
    }
  });
});
