/**
 * Compatibility entry point for agentd-internal tests and imports.
 *
 * The HTTP application is owned by @mobile-agent/agentd-http. Keeping this
 * re-export avoids coupling the composition root back to route internals.
 */
export {
  AgentdHttpError,
  createAgentdApp,
  type AgentdApp,
} from "@mobile-agent/agentd-http";
export type {
  AgentdAuthContext,
  AgentdAuthDevice,
  AgentdAuthPort,
  AgentdHttpDependencies,
  AgentdHttpLogger,
  AgentdHttpStatus,
  AgentdHookEvent,
} from "@mobile-agent/agentd-http";
