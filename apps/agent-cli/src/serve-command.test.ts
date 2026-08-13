import { describe, expect, it } from "vitest";
import { parseServeOptions, runServeCommand } from "./serve-command.js";

describe("agent serve command", () => {
  it("uses an agentd-only Serve profile by default", () => {
    expect(parseServeOptions(["tailscale"], {
      AGENTD_PORT: "4391",
      AGENT_SERVE_PORT: "8444",
      TAILSCALE_BIN: "tailscale-test",
    })).toMatchObject({
      provider: "tailscale",
      agentdHost: "127.0.0.1",
      agentdPort: 4391,
      externalPort: 8444,
      tailscaleBinary: "tailscale-test",
    });
  });

  it("ensures agentd and upserts the fixed Tailscale endpoint", async () => {
    const ensured: unknown[] = [];
    const calls: Array<{ command: string; args: string[] }> = [];
    let output = "";

    await expect(runServeCommand(["tailscale", "--port", "443"], {
      ensureAgentd: async (options) => {
        ensured.push(options);
      },
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { stdout: "", stderr: "" };
      },
      out: (value) => {
        output += value;
      },
    }, {
      AGENTD_PORT: "4391",
      AGENT_TAILSCALE_HOSTNAME: "agent-host.tailnet.ts.net",
    })).resolves.toBe(0);

    expect(ensured).toHaveLength(1);
    expect(calls).toEqual([{
      command: "tailscale",
      args: ["serve", "--bg", "--https=443", "--yes", "http://127.0.0.1:4391"],
    }]);
    expect(output).toContain("https://agent-host.tailnet.ts.net/");
    expect(output).toContain("http://127.0.0.1:4391");
  });

  it("rejects a provider that is not implemented yet", () => {
    expect(() => parseServeOptions(["cloudflare"])).toThrow("unsupported serve provider");
  });
});
