#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const defaultMainDirectory = join(homedir(), ".local", "share", "mobile-agent", "agent-main");
const configuredMainDirectory = process.env.AGENT_MAIN_DIR;
const mainDirectory = resolve(configuredMainDirectory ?? defaultMainDirectory);
const sourceEntry = join(mainDirectory, "apps", "agent-cli", "src", "index.ts");
const runtimeEnvironment = mainEnvironment(process.env);

try {
  ensureMainDirectory();
  ensureDependencies();
  runSource();
} catch (error) {
  process.stderr.write(`agent-main: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function ensureMainDirectory() {
  if (!existsSync(join(mainDirectory, "package.json")) || !existsSync(sourceEntry)) {
    throw new Error([
      `fixed origin/main checkout not found: ${mainDirectory}`,
      `set AGENT_MAIN_DIR or create a checkout there (for example: git worktree add --detach ${mainDirectory} origin/main)`,
    ].join("\n"));
  }
}

function ensureDependencies() {
  const nodeModules = join(mainDirectory, "node_modules");
  const lockfile = join(mainDirectory, "bun.lock");
  const lockHash = existsSync(lockfile)
    ? createHash("sha256").update(readFileSync(lockfile)).digest("hex")
    : "no-lockfile";
  const lockStamp = join(nodeModules, ".mobile-agent-lockfile.sha256");
  if (existsSync(nodeModules) && existsSync(lockStamp) && readFileSync(lockStamp, "utf8").trim() === lockHash) return;
  if (!run(process.execPath, ["install", "--frozen-lockfile"], mainDirectory, false)) {
    throw new Error(`could not install dependencies in the fixed origin/main checkout: ${mainDirectory}`);
  }
  writeFileSync(lockStamp, `${lockHash}\n`, { mode: 0o600 });
}

function runSource() {
  const child = spawn(process.execPath, ["--conditions=development", sourceEntry, ...process.argv.slice(2)], {
    cwd: mainDirectory,
    env: runtimeEnvironment,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`agent-main: could not start the fixed origin/main checkout: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

function mainEnvironment(environment) {
  const stateRoot = resolve(environment.AGENT_MAIN_STATE_ROOT ?? join(homedir(), ".local", "state", "mobile-agent", "agent-main"));
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  return {
    ...environment,
    AGENT_PROFILE: environment.AGENT_PROFILE ?? "main",
    AGENT_WORKTREE_ID: environment.AGENT_WORKTREE_ID ?? "main",
    AGENTD_DB_FILE: environment.AGENTD_DB_FILE ?? join(stateRoot, "agentd.sqlite"),
    AGENT_HOOK_OUTPUT_DIR: environment.AGENT_HOOK_OUTPUT_DIR ?? join(stateRoot, "hooks"),
    AGENTD_PORT: environment.AGENTD_PORT ?? "6317",
  };
}

function run(command, args, cwd, allowFailure) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: allowFailure ? ["ignore", "ignore", "ignore"] : "inherit",
  });
  if (result.error) {
    if (allowFailure) return false;
    throw result.error;
  }
  if (result.status !== 0) {
    if (allowFailure) return false;
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? 1}`);
  }
  return true;
}
