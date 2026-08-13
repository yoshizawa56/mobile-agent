#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const source = resolve(options.source);
const target = resolve(options.target);

try {
  if (samePath(source, target)) {
    process.stdout.write(`SQLite source and target are the same; keeping ${target}\n`);
  } else if (existsSync(target) && !options.force) {
    process.stdout.write(`SQLite target already exists; keeping ${target}\n`);
  } else {
    copyDatabase(source, target, options.force);
    process.stdout.write(`copied SQLite snapshot to ${target}\n`);
  }
} catch (error) {
  process.stderr.write(`copy-sqlite: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const result = { force: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--source") result.source = requiredArgument(args, ++index, argument);
    else if (argument === "--target") result.target = requiredArgument(args, ++index, argument);
    else if (argument === "--force") result.force = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!result.source || !result.target) throw new Error("usage: copy-sqlite.mjs --source FILE --target FILE [--force]");
  return result;
}

function requiredArgument(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function samePath(left, right) {
  return left === right;
}

function copyDatabase(sourcePath, targetPath, force) {
  if (!existsSync(sourcePath)) throw new Error(`SQLite source does not exist: ${sourcePath}`);
  if (!statSync(sourcePath).isFile()) throw new Error(`SQLite source is not a file: ${sourcePath}`);
  mkdirSync(dirname(targetPath), { recursive: true });

  if (force && existsSync(targetPath)) {
    rmSync(targetPath, { force: true });
    for (const sidecar of [`${targetPath}-wal`, `${targetPath}-shm`]) rmSync(sidecar, { force: true });
  }
  if (existsSync(targetPath)) throw new Error(`SQLite target already exists: ${targetPath}`);

  const temporaryTarget = `${targetPath}.tmp-${process.pid}`;
  rmSync(temporaryTarget, { force: true });
  const sourceMode = statSync(sourcePath).mode & 0o777;
  const database = new Database(sourcePath, { readonly: true });
  try {
    const escapedTarget = temporaryTarget.replaceAll("'", "''");
    database.exec(`VACUUM INTO '${escapedTarget}'`);
  } finally {
    database.close();
  }

  try {
    chmodSync(temporaryTarget, sourceMode || 0o600);
    renameSync(temporaryTarget, targetPath);
  } catch (error) {
    rmSync(temporaryTarget, { force: true });
    throw error;
  }
}
