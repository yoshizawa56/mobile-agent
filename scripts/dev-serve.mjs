#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { isProcessAlive, readRuntimeManifest, resolveWorktreeRuntime } from "./dev-state.mjs";

const runtime = resolveWorktreeRuntime(process.env, process.cwd());
const manifest = readRuntimeManifest(runtime);

if (!manifest || manifest.worktreeId !== runtime.worktreeId || manifest.worktreePath !== runtime.worktreePath) {
  fail("no active dev runtime was found for this worktree; run 'bun run dev' first");
}
if (!isProcessAlive(manifest.supervisorPid)) {
  fail("the dev runtime manifest is stale; run 'bun run dev' again");
}

const response = await fetch(`http://127.0.0.1:${manifest.webPort}/`);
if (!response.ok) {
  fail(`the worktree Web server is not healthy on port ${manifest.webPort}`);
}

const tailscale = spawnSync("tailscale", ["--version"], { stdio: "ignore" });
if (tailscale.error || tailscale.status !== 0) {
  fail("tailscale CLI not found; install and configure Tailscale separately, then rerun 'mise run dev-serve'");
}

const tailscalePort = process.env.TAILSCALE_DEV_PORT ? String(runtime.tailscalePort) : String(manifest.tailscalePort);
const result = spawnSync(
  "tailscale",
  ["serve", "--bg", `--https=${tailscalePort}`, String(manifest.webPort)],
  { stdio: "inherit" },
);
if (result.error) fail(`failed to start Tailscale Serve: ${result.error.message}`);
process.exitCode = result.status ?? 1;

function fail(message) {
  console.error(`[dev-serve] ${message}`);
  process.exitCode = 1;
  process.exit();
}
