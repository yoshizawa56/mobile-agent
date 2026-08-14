import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type AgentdInstancePaths = {
  instanceDirectory: string;
  databaseFile: string;
  hookOutputDirectory: string;
  pidFile: string;
  controlSocket: string;
};

export type AgentdPathOverrides = {
  databaseFile?: string;
  hookOutputDirectory?: string;
  pidFile?: string;
  controlSocket?: string;
};

export const agentdControlSocketMaxBytes = 103;

/**
 * Resolve the filesystem paths owned by one agentd instance.
 *
 * AGENTD_INSTANCE_DIR is the normal configuration surface. The individual
 * path variables remain supported as advanced and legacy overrides, but an
 * instance directory always supplies deterministic defaults for the paths
 * that were not overridden explicitly.
 */
export function resolveAgentdPaths(
  env: NodeJS.ProcessEnv = process.env,
  overrides: AgentdPathOverrides = {},
): AgentdInstancePaths {
  const configuredInstanceDirectory = nonEmptyPath(env.AGENTD_INSTANCE_DIR);
  const hasConfiguredInstanceDirectory = Boolean(configuredInstanceDirectory);
  const instanceDirectory = resolve(configuredInstanceDirectory ?? defaultAgentdInstanceDirectory(env));
  const configuredDatabaseFile = nonEmptyPath(overrides.databaseFile) ?? nonEmptyPath(env.AGENTD_DB_FILE) ?? nonEmptyPath(env.AGENT_DATABASE_FILE);
  const databaseFile = resolveDatabaseFile(configuredDatabaseFile ?? join(instanceDirectory, "agentd.sqlite"));
  const hookOutputDirectory = resolvePath(nonEmptyPath(overrides.hookOutputDirectory) ?? nonEmptyPath(env.AGENT_HOOK_OUTPUT_DIR) ?? join(instanceDirectory, "hooks"));
  const pidFile = resolvePath(
    nonEmptyPath(overrides.pidFile)
      ?? nonEmptyPath(env.AGENTD_PID_FILE)
      ?? (hasConfiguredInstanceDirectory ? defaultPidFile(instanceDirectory, databaseFile) : legacyPidFile(databaseFile, instanceDirectory)),
  );
  const controlSocket = resolvePath(
    nonEmptyPath(overrides.controlSocket)
      ?? nonEmptyPath(env.AGENTD_CONTROL_SOCKET)
      ?? (hasConfiguredInstanceDirectory ? defaultControlSocket(instanceDirectory) : legacyControlSocket(databaseFile, instanceDirectory)),
  );

  return { instanceDirectory, databaseFile, hookOutputDirectory, pidFile, controlSocket };
}

export function defaultAgentdInstanceDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME ?? homedir(), ".local", "state", "mobile-agent");
}

export function validateAgentdControlSocketPath(path: string): void {
  const bytes = Buffer.byteLength(path);
  if (bytes > agentdControlSocketMaxBytes) {
    throw new Error(`agentd control socket path is too long (${bytes} bytes; maximum ${agentdControlSocketMaxBytes}): ${path}`);
  }
}

function defaultPidFile(instanceDirectory: string, databaseFile: string): string {
  return databaseFile === ":memory:" ? join(instanceDirectory, "agentd.pid") : join(instanceDirectory, "agentd.sqlite.pid");
}

function defaultControlSocket(instanceDirectory: string): string {
  return join(instanceDirectory, "agentd.sock");
}

function legacyPidFile(databaseFile: string, instanceDirectory: string): string {
  return databaseFile === ":memory:" ? join(instanceDirectory, "agentd.pid") : `${databaseFile}.pid`;
}

function legacyControlSocket(databaseFile: string, instanceDirectory: string): string {
  return databaseFile === ":memory:" ? join(instanceDirectory, "agentd.control.sock") : `${databaseFile}.control.sock`;
}

function resolveDatabaseFile(value: string): string {
  return value === ":memory:" ? value : resolve(value);
}

function resolvePath(value: string): string {
  return resolve(value);
}

function nonEmptyPath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
