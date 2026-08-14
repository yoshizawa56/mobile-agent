import { describe, expect, it } from "vitest";
import { buildServeArgs, buildServeHttpUrl, buildServeUrl, buildTailscaleInvocation, normalizeTailscaleStdout, parseTailscaleHostname } from "./index.js";

type InvocationCase = {
  name: string;
  binary: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  executablePaths: string[];
  allowShellFallback?: boolean;
  shellFallback: boolean;
  command: string;
  invocationArgs: string[];
  path: string;
  cliMode: string;
};

const invocationCases = [
  {
    name: "runs a named macOS command through the configured interactive shell",
    binary: "tailscale",
    args: ["serve", "--set-path=/agent's", "http://127.0.0.1:4317"],
    environment: { HOME: "/Users/tester", PATH: "/usr/bin", SHELL: "/bin/zsh" },
    platform: "darwin" as const,
    executablePaths: [],
    shellFallback: true,
    command: "/bin/zsh",
    invocationArgs: ["-ic", "printf '%s\\n' '__mobile_agent_tailscale_stdout_begin__'; tailscale 'serve' '--set-path=/agent'\\''s' 'http://127.0.0.1:4317'; status=$?; printf '%s\\n' '__mobile_agent_tailscale_stdout_end__'; exit \"$status\""],
    path: "/usr/bin:/Applications/Tailscale.app/Contents/MacOS:/Users/tester/Applications/Tailscale.app/Contents/MacOS",
    cliMode: "1",
  },
  {
    name: "keeps an explicit executable path direct",
    binary: "/opt/tailscale/Tailscale",
    args: ["status", "--json"],
    environment: { PATH: "/usr/bin", TAILSCALE_BE_CLI: "0" },
    platform: "darwin" as const,
    executablePaths: [],
    shellFallback: false,
    command: "/opt/tailscale/Tailscale",
    invocationArgs: ["status", "--json"],
    path: "/usr/bin",
    cliMode: "0",
  },
  {
    name: "keeps a PATH executable direct",
    binary: "tailscale",
    args: ["serve", "--bg"],
    environment: { PATH: "/usr/bin" },
    platform: "darwin" as const,
    executablePaths: ["/usr/bin/tailscale"],
    shellFallback: false,
    command: "tailscale",
    invocationArgs: ["serve", "--bg"],
    path: "/usr/bin",
    cliMode: "1",
  },
  {
    name: "uses the bundled macOS CLI when it is not on PATH",
    binary: "tailscale",
    args: ["status", "--json"],
    environment: { HOME: "/Users/tester", PATH: "/usr/bin", SHELL: "/bin/zsh" },
    platform: "darwin" as const,
    executablePaths: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
    shellFallback: false,
    command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    invocationArgs: ["status", "--json"],
    path: "/usr/bin",
    cliMode: "1",
  },
  {
    name: "can disable shell fallback for synchronous daemon lookups",
    binary: "tailscale",
    args: ["ip", "-4"],
    environment: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
    platform: "darwin" as const,
    executablePaths: [],
    allowShellFallback: false,
    shellFallback: false,
    command: "tailscale",
    invocationArgs: ["ip", "-4"],
    path: "/usr/bin",
    cliMode: "1",
  },
] satisfies readonly InvocationCase[];

describe("tailscale serve adapter", () => {
  it.each(invocationCases)("$name", (testCase: InvocationCase) => {
    const invocation = buildTailscaleInvocation(
      testCase.binary,
      [...testCase.args],
      testCase.environment,
      testCase.platform,
      {
        isExecutable: (path) => testCase.executablePaths.includes(path),
        ...(testCase.allowShellFallback === undefined ? {} : { allowShellFallback: testCase.allowShellFallback }),
      },
    );

    expect(invocation.command).toBe(testCase.command);
    expect(invocation.args).toEqual(testCase.invocationArgs);
    expect(invocation.environment.PATH).toBe(testCase.path);
    expect(invocation.environment.TAILSCALE_BE_CLI).toBe(testCase.cliMode);
    expect(invocation.stdoutMarkers !== undefined).toBe(testCase.shellFallback);
  });

  it.each([
    {
      name: "extracts command output between shell markers",
      stdout: "zsh startup message\n__mobile_agent_tailscale_stdout_begin__\n{\"Self\":{}}\n__mobile_agent_tailscale_stdout_end__\n",
      expected: "{\"Self\":{}}\n",
    },
    {
      name: "preserves output when the shell did not reach the marker",
      stdout: "zsh startup failure\n",
      expected: "zsh startup failure\n",
    },
  ])("$name", ({ stdout, expected }) => {
    const invocation = buildTailscaleInvocation("tailscale", ["status", "--json"], { PATH: "/usr/bin" }, "linux", {
      isExecutable: () => false,
    });
    expect(normalizeTailscaleStdout(stdout, invocation)).toBe(expected);
  });

  it.each([
    { localPort: 4317, externalPort: 443, args: ["serve", "--bg", "--https=443", "--yes", "http://127.0.0.1:4317"] },
    { localPort: 1, externalPort: 8449, args: ["serve", "--bg", "--https=8449", "--yes", "http://127.0.0.1:1"] },
  ])("builds a persistent HTTPS Serve command", ({ localPort, externalPort, args }) => {
    expect(buildServeArgs({ localPort, externalPort })).toEqual(args);
  });

  it("builds a path-mounted Serve command", () => {
    expect(buildServeArgs({ localPort: 4317, externalPort: 443, path: "agentd" })).toEqual([
      "serve", "--bg", "--https=443", "--yes", "--set-path=/agentd", "http://127.0.0.1:4317",
    ]);
  });

  it("builds a websocket URL for the Serve endpoint", () => {
    expect(buildServeUrl("host.tailnet.ts.net", "agent")).toBe("wss://host.tailnet.ts.net/agent");
  });

  it.each([
    { port: 443, expected: "https://host.tailnet.ts.net/" },
    { port: 8449, expected: "https://host.tailnet.ts.net:8449/" },
  ])("builds an HTTPS Serve URL without a port for 443", ({ port, expected }) => {
    expect(buildServeHttpUrl("host.tailnet.ts.net", port)).toBe(expected);
  });

  it("reads the current node DNS name from Tailscale status JSON", () => {
    expect(parseTailscaleHostname(JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } }))).toBe("host.tailnet.ts.net");
    expect(parseTailscaleHostname("not json")).toBeUndefined();
  });

  it("rejects an invalid port", () => {
    expect(() => buildServeArgs({ localPort: 65_536, externalPort: 443 })).toThrow("Invalid Tailscale Serve port");
    expect(() => buildServeArgs({ localPort: 4317, externalPort: 65_536 })).toThrow("Invalid Tailscale Serve external port");
  });
});
