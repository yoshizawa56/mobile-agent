#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.AGENT_BUILD_OUTPUT ?? "dist/agent";
const target = process.env.AGENT_BUILD_TARGET;
const outputPath = isAbsolute(output) ? output : join(repositoryRoot, output);

mkdirSync(dirname(outputPath), { recursive: true });
run(process.execPath, ["scripts/sync-embedded-migrations.mjs"], repositoryRoot);

const buildArgs = ["build", "apps/agent-cli/src/index.ts", "--compile", "--minify"];
if (target) buildArgs.push(`--target=${target}`);
buildArgs.push("--outfile", outputPath);
run(process.execPath, buildArgs, repositoryRoot);

const migrationsSource = join(repositoryRoot, "packages", "persistence", "drizzle");
const migrationsOutput = join(dirname(outputPath), "migrations");
cpSync(migrationsSource, migrationsOutput, { recursive: true, force: true });

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
