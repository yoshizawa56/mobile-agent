import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

export const DEFAULT_DEV_PORTS = {
  agentd: 4317,
  web: 5227,
  tailscale: 8449,
};

const PORT_SLOT_COUNT = 900;
const RUNTIME_DIRECTORY = [".mobile-agent", "dev"];

export function parseWorktreeList(output) {
  const entries = [];
  let current;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (line.startsWith("branch ") && current) current.branch = line.slice("branch ".length);
    if (line === "detached" && current) current.detached = true;
  }
  if (current) entries.push(current);
  return entries;
}

export function resolveWorktreeRuntime(environment = process.env, cwd = process.cwd(), options = {}) {
  const worktreePath = canonicalPath(cwd);
  const entries = options.worktreeList
    ? parseWorktreeList(options.worktreeList)
    : listWorktrees(worktreePath);
  const primaryPath = canonicalPath(entries[0]?.path ?? worktreePath);
  const isPrimary = worktreePath === primaryPath;
  const digest = createHash("sha256").update(worktreePath).digest("hex");
  const worktreeId = digest.slice(0, 12);
  const slot = 1 + (Number.parseInt(digest.slice(0, 8), 16) % PORT_SLOT_COUNT);
  const runtimeDirectory = join(worktreePath, ...RUNTIME_DIRECTORY);
  const explicitDatabaseFile = environment.AGENTD_DB_FILE ?? environment.AGENT_DATABASE_FILE;
  const explicitTmuxSocket = environment.AGENTD_TMUX_SOCKET;
  const databaseFile = explicitDatabaseFile === ":memory:"
    ? ":memory:"
    : explicitDatabaseFile
      ? resolve(worktreePath, explicitDatabaseFile)
      : join(runtimeDirectory, "agentd.sqlite");

  return {
    worktreePath,
    primaryPath,
    isPrimary,
    worktreeId,
    runtimeDirectory,
    databaseFile,
    explicitDatabaseFile: Boolean(explicitDatabaseFile),
    tmuxSocket: explicitTmuxSocket ?? join(tmpdir(), `mobile-agent-${worktreeId}.sock`),
    ownsTmuxSocket: !explicitTmuxSocket,
    tmuxTarget: environment.AGENTD_DEFAULT_TMUX_TARGET ?? `mobile-agent-${worktreeId.slice(0, 8)}`,
    manifestFile: join(runtimeDirectory, "runtime.json"),
    lockFile: join(runtimeDirectory, "runtime.lock"),
    runToken: randomUUID(),
    agentdPort: readPort(environment.AGENTD_PORT, isPrimary ? DEFAULT_DEV_PORTS.agentd : DEFAULT_DEV_PORTS.agentd + slot * 2),
    webPort: readPort(environment.VITE_DEV_PORT, isPrimary ? DEFAULT_DEV_PORTS.web : DEFAULT_DEV_PORTS.web + slot * 2),
    tailscalePort: readPort(environment.TAILSCALE_DEV_PORT, isPrimary ? DEFAULT_DEV_PORTS.tailscale : DEFAULT_DEV_PORTS.tailscale + slot),
    legacyDatabaseFile: environment.AGENTD_LEGACY_DB_FILE ?? joinHomeStatePath(environment),
  };
}

export function initializeWorktreeDatabase(runtime) {
  if (runtime.explicitDatabaseFile || runtime.databaseFile === ":memory:") {
    return { created: false, seededFrom: undefined };
  }

  mkdirSync(runtime.runtimeDirectory, { recursive: true, mode: 0o700 });
  if (existsSync(runtime.databaseFile)) {
    verifySqlite(runtime.databaseFile);
    return { created: false, seededFrom: undefined };
  }

  const source = findSeedDatabase(runtime);
  if (source) {
    snapshotSqlite(source, runtime.databaseFile);
    return { created: true, seededFrom: source };
  }

  const database = new Database(runtime.databaseFile);
  database.close();
  return { created: true, seededFrom: undefined };
}

export function findSeedDatabase(runtime) {
  const candidates = runtime.isPrimary
    ? [runtime.legacyDatabaseFile]
    : [join(runtime.primaryPath, ...RUNTIME_DIRECTORY, "agentd.sqlite"), runtime.legacyDatabaseFile];
  return candidates.find((candidate) => candidate && candidate !== runtime.databaseFile && existsSync(candidate));
}

export function snapshotSqlite(sourceFile, destinationFile) {
  mkdirSync(dirname(destinationFile), { recursive: true, mode: 0o700 });
  const temporaryFile = `${destinationFile}.${process.pid}.${randomUUID()}.tmp`;
  const source = new Database(sourceFile);
  try {
    source.exec("PRAGMA busy_timeout = 5000");
    source.exec(`VACUUM INTO '${escapeSqliteString(temporaryFile)}'`);
    verifySqlite(temporaryFile);
    renameSync(temporaryFile, destinationFile);
  } finally {
    source.close();
    if (existsSync(temporaryFile)) unlinkSync(temporaryFile);
  }
}

export function acquireRuntimeLock(runtime) {
  mkdirSync(runtime.runtimeDirectory, { recursive: true, mode: 0o700 });
  const lock = {
    pid: process.pid,
    worktreeId: runtime.worktreeId,
    runToken: runtime.runToken,
  };

  let fileDescriptor;
  try {
    fileDescriptor = openSync(runtime.lockFile, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = readJson(runtime.lockFile);
    if (!existing || isProcessAlive(existing.pid)) {
      throw new Error(`another dev process already owns ${runtime.worktreePath}`);
    }
    unlinkSync(runtime.lockFile);
    fileDescriptor = openSync(runtime.lockFile, "wx", 0o600);
  }

  writeFileSync(fileDescriptor, `${JSON.stringify(lock)}\n`, "utf8");
  return {
    release() {
      try {
        closeSync(fileDescriptor);
      } catch {
        // The descriptor may already have been closed during error cleanup.
      }
      const current = readJson(runtime.lockFile);
      if (current?.runToken === runtime.runToken) {
        unlinkSync(runtime.lockFile);
      }
    },
  };
}

export function writeRuntimeManifest(runtime, extra = {}) {
  mkdirSync(runtime.runtimeDirectory, { recursive: true, mode: 0o700 });
  atomicWriteJson(runtime.manifestFile, {
    schemaVersion: 1,
    worktreePath: runtime.worktreePath,
    worktreeId: runtime.worktreeId,
    agentdPort: runtime.agentdPort,
    webPort: runtime.webPort,
    tailscalePort: runtime.tailscalePort,
    tmuxSocket: runtime.tmuxSocket,
    tmuxTarget: runtime.tmuxTarget,
    databaseFile: runtime.databaseFile,
    supervisorPid: process.pid,
    runToken: runtime.runToken,
    ...extra,
  });
}

export function readRuntimeManifest(runtime) {
  return readJson(runtime.manifestFile);
}

export function removeRuntimeManifest(runtime) {
  const current = readRuntimeManifest(runtime);
  if (current?.runToken !== runtime.runToken) return;
  if (existsSync(runtime.manifestFile)) unlinkSync(runtime.manifestFile);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function listWorktrees(cwd) {
  try {
    return parseWorktreeList(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" }));
  } catch {
    return [];
  }
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readPort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("development ports must be integers between 1 and 65535");
  }
  return port;
}

function joinHomeStatePath(environment) {
  const home = environment.HOME ?? homedir();
  return join(home, ".local", "state", "mobile-agent", "agentd.sqlite");
}

function escapeSqliteString(value) {
  return value.replaceAll("'", "''");
}

function verifySqlite(file) {
  const database = new Database(file);
  try {
    const result = database.prepare("PRAGMA quick_check").get();
    const value = result && Object.values(result)[0];
    if (value !== "ok") throw new Error(`SQLite quick_check failed for ${file}`);
  } finally {
    database.close();
  }
}

function atomicWriteJson(file, value) {
  const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryFile, file);
}

function readJson(file) {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"));
}
