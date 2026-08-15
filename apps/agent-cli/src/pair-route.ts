import {
  ensureLocalAgentd,
  ensureTailscaleServe,
  localAgentdUrl,
  parseServeOptions,
  type ServeCommandDependencies,
} from "./serve-command.js";

export type PairRouteDependencies = Pick<ServeCommandDependencies, "ensureAgentd" | "runCommand" | "logger">;

/**
 * Resolves the endpoint that the QR client will use for both claiming and
 * subsequent authenticated connections. Tailscale Serve is the default
 * route; --without-serve keeps the endpoint local for same-host clients or a
 * future local-forward adapter.
 */
export async function resolvePairAgentdBaseUrl(
  input: { withoutServe: boolean; environment: NodeJS.ProcessEnv },
  dependencies: PairRouteDependencies = {},
): Promise<string> {
  const options = parseServeOptions(["tailscale"], input.environment);
  if (input.withoutServe) {
    await (dependencies.ensureAgentd ?? ensureLocalAgentd)(options);
    return localAgentdUrl(options.agentdHost, options.agentdPort);
  }

  const result = await ensureTailscaleServe(options, dependencies, input.environment);
  if (!result.url) {
    throw new Error("could not determine the Tailscale Serve URL; set AGENT_TAILSCALE_HOSTNAME or AGENTD_PAIRING_BASE_URL");
  }
  return result.url;
}
