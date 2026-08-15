import { describe, expect, it } from "vitest";
import {
  hasError,
  hasObserved,
  returns,
  runOperationTable,
  type FixtureHandle,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import type { ServeCommandOptions } from "./serve-command.js";
import { resolvePairAgentdBaseUrl } from "./pair-route.js";

type PairRouteFixture = {
  ensured: ServeCommandOptions[];
  calls: Array<{ command: string; args: string[] }>;
};
type PairRouteInput = {
  withoutServe: boolean;
  environment: NodeJS.ProcessEnv;
};
type PairRouteContext = {
  ensured: readonly ServeCommandOptions[];
  calls: readonly { command: string; args: string[] }[];
};
type PairRouteResult = string;

const pairRouteFixture = (): FixtureHandle<PairRouteFixture> => ({
  fixture: { ensured: [], calls: [] },
});

const pairRouteCases = [
  {
    name: "configures agentd-only Tailscale Serve by default",
    input: { withoutServe: false, environment: { AGENTD_PORT: "4391", AGENT_SERVE_PORT: "8444" } },
    assert: [
      returns<PairRouteContext, PairRouteResult>("https://agent-host.tailnet.ts.net:8444/"),
      hasObserved<PairRouteContext, PairRouteResult>("ensured", [expect.objectContaining({ agentdPort: 4391, externalPort: 8444 })]),
      hasObserved<PairRouteContext, PairRouteResult>("calls", [
        { command: "tailscale", args: ["serve", "--bg", "--https=8444", "--yes", "http://127.0.0.1:4391"] },
        { command: "tailscale", args: ["status", "--json"] },
      ]),
    ],
  },
  {
    name: "uses the local agentd endpoint with --without-serve",
    input: { withoutServe: true, environment: { AGENTD_HOST: "0.0.0.0", AGENTD_PORT: "4392" } },
    assert: [
      returns<PairRouteContext, PairRouteResult>("http://127.0.0.1:4392"),
      hasObserved<PairRouteContext, PairRouteResult>("ensured", [expect.objectContaining({ agentdPort: 4392 })]),
      hasObserved<PairRouteContext, PairRouteResult>("calls", []),
    ],
  },
  {
    name: "requires a discoverable hostname for the default Serve route",
    input: { withoutServe: false, environment: { AGENTD_PORT: "4393", TEST_EMPTY_TAILSCALE_STATUS: "1" } },
    assert: [hasError<PairRouteContext, PairRouteResult>({ message: /could not determine the Tailscale Serve URL/ })],
  },
] satisfies readonly OperationCase<"default", PairRouteInput, PairRouteResult, PairRouteContext>[];

const pairRouteTable: OperationTable<PairRouteFixture, "default", PairRouteInput, PairRouteResult, PairRouteContext> = {
  defaultFixture: pairRouteFixture,
  cases: pairRouteCases,
  execute: async (fixture, input) => resolvePairAgentdBaseUrl(input, {
    ensureAgentd: async (options) => { fixture.ensured.push({ ...options }); },
    runCommand: async (command, args) => {
      fixture.calls.push({ command, args });
      return args[0] === "status"
        ? { stdout: input.environment.TEST_EMPTY_TAILSCALE_STATUS ? "{}" : JSON.stringify({ Self: { DNSName: "agent-host.tailnet.ts.net." } }), stderr: "" }
        : { stdout: "", stderr: "" };
    },
  }),
  observe: (fixture) => ({ ensured: [...fixture.ensured], calls: [...fixture.calls] }),
};

describe("agent pair route resolution", () => {
  runOperationTable(it as unknown as TestRegistrar, pairRouteTable);
});
