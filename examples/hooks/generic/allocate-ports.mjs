#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_STRIDE = 2;
const DEFAULT_SLOT_COUNT = 20_000;

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command !== "allocate") {
    throw new Error("port allocation is deterministic; there is no release step");
  }
  allocate(options);
} catch (error) {
  process.stderr.write(`allocate-ports: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function allocate(options) {
  const key = required(options, "key");
  const envPath = requiredPath(options, "env-path");
  const ports = options.ports;
  if (ports.length === 0) throw new Error("allocate requires at least one --port NAME=BASE option");

  const stride = positiveInteger(options.stride ?? String(DEFAULT_STRIDE), "stride");
  const slotCount = positiveInteger(options["slot-count"] ?? String(DEFAULT_SLOT_COUNT), "slot-count");
  validatePortLanes(ports, stride, slotCount);

  const slot = deterministicSlot(key, slotCount);
  const existing = readEnvAssignments(envPath);
  const portValues = {};
  const preserved = new Set();

  for (const { name, base } of ports) {
    const derived = base + slot * stride;
    const value = existing[name] ?? String(derived);
    validatePort(value, name, envPath);
    portValues[name] = value;
    if (existing[name] !== undefined) preserved.add(name);
  }

  const values = {
    ...portValues,
    ...Object.fromEntries(options.values.map(({ name, value }) => [name, value])),
  };
  for (const { name } of options.values) {
    if (ports.some((port) => port.name === name)) {
      throw new Error(`--set cannot override a --port variable: ${name}`);
    }
  }

  if (new Set(Object.values(portValues)).size !== ports.length) {
    throw new Error(`port assignments overlap in ${envPath}; choose different port values`);
  }

  updateEnvFile(envPath, values, preserved);
  for (const { name } of ports) {
    const status = preserved.has(name) ? "preserved" : "derived";
    process.stdout.write(`${status} ${name}=${portValues[name]} (slot ${slot})\n`);
  }
}

function parseArguments(args) {
  const command = args.shift();
  const options = { ports: [], values: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--port") {
      options.ports.push(parsePort(requireArgument(args, ++index, argument)));
    } else if (argument === "--set") {
      options.values.push(parseAssignment(requireArgument(args, ++index, argument)));
    } else if (argument === "--key") {
      options.key = requireArgument(args, ++index, argument);
    } else if (argument === "--env-path") {
      options["env-path"] = requireArgument(args, ++index, argument);
    } else if (argument === "--stride") {
      options.stride = requireArgument(args, ++index, argument);
    } else if (argument === "--slot-count") {
      options["slot-count"] = requireArgument(args, ++index, argument);
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: allocate-ports.mjs allocate --key KEY --env-path FILE --port NAME=BASE [options]\n");
      process.exit(0);
    } else if (argument.startsWith("--")) {
      throw new Error(`unknown option: ${argument}`);
    } else {
      throw new Error(`unexpected argument: ${argument}`);
    }
  }
  return { command, options };
}

function parsePort(value) {
  const assignment = parseAssignment(value);
  return { name: assignment.name, base: positivePort(assignment.value, assignment.name) };
}

function parseAssignment(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) throw new Error(`expected NAME=VALUE, got: ${value}`);
  const name = value.slice(0, separator);
  const assignmentValue = value.slice(separator + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid environment variable name: ${name}`);
  return { name, value: assignmentValue };
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function requiredPath(options, name) {
  return resolve(required(options, name));
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

function positivePort(value, name) {
  const port = positiveInteger(value, name);
  if (port > 65_535) throw new Error(`${name} must be between 1 and 65535`);
  return port;
}

function requireArgument(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function validatePort(value, name, envPath) {
  try {
    positivePort(value, name);
  } catch {
    throw new Error(`${envPath} contains an invalid ${name}=${value}`);
  }
}

function validatePortLanes(ports, stride, slotCount) {
  const residues = new Set();
  for (const { name, base } of ports) {
    const maximum = base + (slotCount - 1) * stride;
    if (maximum > 65_535) throw new Error(`${name} exceeds port 65535 with the selected slot-count and stride`);
    const residue = base % stride;
    if (residues.has(residue)) {
      throw new Error(`port bases must use different lanes modulo stride; adjust --stride or --port for ${name}`);
    }
    residues.add(residue);
  }
}

function deterministicSlot(key, slotCount) {
  const digest = createHash("sha256").update(key).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % slotCount;
}

function readEnvAssignments(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && values[match[1]] === undefined) values[match[1]] = parseEnvValue(match[2]);
  }
  return values;
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function updateEnvFile(path, values, preservedNames) {
  mkdirSync(dirname(path), { recursive: true });
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const names = new Set(Object.keys(values));
  const seen = new Set();
  const next = [];

  for (const line of original.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match || !names.has(match[1])) {
      next.push(line);
      continue;
    }
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    if (preservedNames.has(match[1])) next.push(line);
    else next.push(`${match[1]}=${formatEnvValue(values[match[1]])}`);
  }

  for (const [name, value] of Object.entries(values)) {
    if (!seen.has(name)) next.push(`${name}=${formatEnvValue(value)}`);
  }

  while (next.length > 0 && next.at(-1) === "") next.pop();
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${next.join("\n")}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function formatEnvValue(value) {
  const stringValue = String(value);
  return /^[A-Za-z0-9_./:-]+$/.test(stringValue) ? stringValue : JSON.stringify(stringValue);
}
