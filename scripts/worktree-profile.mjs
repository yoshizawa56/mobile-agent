import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const defaultStateRoot = join(homedir(), ".local", "state", "mobile-agent");

export function applyDevWorktreeProfile(env = process.env, cwd = process.cwd()) {
  const profile = resolveDevWorktreeProfile(env, cwd);
  mkdirSync(profile.stateRoot, { recursive: true, mode: 0o700 });

  return {
    ...env,
    AGENT_PROFILE: env.AGENT_PROFILE ?? profile.name,
    AGENT_WORKTREE_ID: env.AGENT_WORKTREE_ID ?? profile.id,
    AGENTD_DB_FILE: env.AGENTD_DB_FILE ?? profile.databaseFile,
    AGENT_HOOK_OUTPUT_DIR: env.AGENT_HOOK_OUTPUT_DIR ?? profile.hookOutputRoot,
    AGENTD_PORT: env.AGENTD_PORT ?? String(profile.agentdPort),
    VITE_DEV_PORT: env.VITE_DEV_PORT ?? String(profile.webPort),
  };
}

export function resolveDevWorktreeProfile(env = process.env, cwd = process.cwd()) {
  const worktreeRoot = gitWorktreeRoot(cwd) ?? realpathSafe(cwd);
  const id = createHash("sha256").update(worktreeRoot).digest("hex").slice(0, 16);
  const stateBase = resolve(env.AGENT_DEV_STATE_ROOT ?? defaultStateRoot);
  const stateRoot = join(stateBase, "worktrees", id);
  const seed = Number.parseInt(id.slice(0, 8), 16);

  return {
    id,
    name: "dev",
    worktreeRoot,
    stateRoot,
    databaseFile: join(stateRoot, "agentd.sqlite"),
    hookOutputRoot: join(stateRoot, "hooks"),
    agentdPort: 4_318 + (seed % 1_000),
    webPort: 5_320 + (seed % 1_000),
  };
}

function gitWorktreeRoot(cwd) {
  try {
    return realpathSafe(execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim());
  } catch {
    return undefined;
  }
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
