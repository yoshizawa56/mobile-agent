#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(process.env.AGENT_RELEASE_BINARY ?? join(homedir(), ".local", "libexec", "mobile-agent", "agent"));

if (!existsSync(binary)) {
  process.stderr.write([
    `agent: production binary not found: ${binary}`,
    "agent: install the latest stable release with 'bun run agent:install' or set AGENT_RELEASE_BINARY",
    "agent: use 'agent_main' for the fixed origin/main checkout",
  ].join("\n") + "\n");
  process.exitCode = 1;
} else {
  const child = spawn(binary, process.argv.slice(2), {
    cwd: process.cwd(),
    env: releaseEnvironment(process.env),
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`agent: could not start production binary: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

function releaseEnvironment(environment) {
  const result = {
    ...environment,
    AGENT_PROFILE: "release",
  };
  delete result.AGENT_WORKTREE_ID;
  delete result.AGENT_DEV_STATE_ROOT;
  return result;
}
