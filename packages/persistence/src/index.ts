import { Database } from "bun:sqlite";
import { and, asc, desc, eq, isNull, like, lt, notInArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAgentdPaths } from "./paths.js";
import type {
  AgentSessionRepository,
  PaneFilter,
  PaneRepository,
  RunRepository,
  WorkspaceRepository,
} from "@mobile-agent/application";
import type {
  AgentSessionRecord,
  PaneRecord,
  RunRecord,
  WorkspaceRecord,
} from "@mobile-agent/domain";
import {
  agentSessions,
  auditEvents,
  panes,
  runs,
  workspaces,
  type AgentSessionRow,
  type PaneRow,
  type RunRow,
  type WorkspaceRow,
} from "./schema.js";
import { embeddedMigrationFiles } from "./embedded-migrations.generated.js";

export { agentSessions, auditEvents, panes, runs, workspaces } from "./schema.js";
export { agentdControlSocketMaxBytes, defaultAgentdInstanceDirectory, resolveAgentdPaths, validateAgentdControlSocketPath } from "./paths.js";
export type { AgentdInstancePaths, AgentdPathOverrides } from "./paths.js";
export { AuthStore, AuthStoreError } from "./auth.js";
export type {
  AuthDeviceRecord,
  AuthDeviceStatus,
  AuthDeviceType,
  AuthPairingRecord,
  AuthPairingStatus,
  AuthSessionRecord,
  ClaimPairingInput,
  ClaimPairingResult,
  CreatePairingInput,
  CreatePairingResult,
} from "./auth.js";

export type AgentDatabase = {
  db: ReturnType<typeof drizzle>;
  sqlite: Database;
  close: () => void;
};

export type AgentDatabaseOptions = {
  migrationsFolder?: string;
  instanceDirectory?: string;
};

export function defaultAgentDatabaseFile(env: NodeJS.ProcessEnv = process.env): string {
  return resolveAgentdPaths(env).databaseFile;
}

export function createAgentDatabase(file: string | undefined = undefined, options: AgentDatabaseOptions = {}): AgentDatabase {
  const databaseFile = file ?? defaultCreateDatabaseFile(process.env);
  const databasePath = databaseFile === ":memory:" ? databaseFile : resolve(databaseFile);
  const configuredInstanceDirectory = file === undefined && process.env.AGENTD_INSTANCE_DIR?.trim()
    ? resolveAgentdPaths(process.env).instanceDirectory
    : undefined;
  const instanceDirectory = options.instanceDirectory ?? configuredInstanceDirectory;
  if (databasePath !== ":memory:") {
    if (instanceDirectory) {
      const resolvedInstanceDirectory = resolve(instanceDirectory);
      mkdirSync(resolvedInstanceDirectory, { recursive: true, mode: 0o700 });
      chmodSync(resolvedInstanceDirectory, 0o700);
    }
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(databasePath);
  secureDatabaseFiles(databasePath);
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const migrationsFolder = options.migrationsFolder ?? findAgentMigrationsFolder() ?? materializeEmbeddedMigrations();
  baselineLegacyDatabase(sqlite, migrationsFolder);
  const db = drizzle({ client: sqlite });
  try {
    migrate(db, { migrationsFolder });
  } catch (error) {
    sqlite.close();
    throw new Error(`database migration failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  ensureAuthSchema(sqlite);
  secureDatabaseFiles(databasePath);

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

function secureDatabaseFiles(databasePath: string): void {
  if (databasePath === ":memory:") return;
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600);
  }
}

function defaultCreateDatabaseFile(env: NodeJS.ProcessEnv): string {
  const configured = [env.AGENTD_INSTANCE_DIR, env.AGENTD_DB_FILE, env.AGENT_DATABASE_FILE].some((value) => Boolean(value?.trim()));
  if (!configured) return ":memory:";
  return resolveAgentdPaths(env).databaseFile;
}

export function defaultAgentMigrationsFolder(env: NodeJS.ProcessEnv = process.env): string {
  const folder = findAgentMigrationsFolder(env);
  if (!folder) {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const executableDirectory = dirname(process.execPath);
    throw new Error(`database migration files not found; set AGENTD_MIGRATIONS_DIR (searched: ${[
      env.AGENTD_MIGRATIONS_DIR ? resolve(process.cwd(), env.AGENTD_MIGRATIONS_DIR) : undefined,
      env.AGENT_MIGRATIONS_DIR ? resolve(process.cwd(), env.AGENT_MIGRATIONS_DIR) : undefined,
      join(moduleDirectory, "../drizzle"),
      join(executableDirectory, "migrations"),
      join(process.cwd(), "packages/persistence/drizzle"),
      join(process.cwd(), "drizzle"),
    ].filter((candidate): candidate is string => Boolean(candidate)).join(", ")})`);
  }
  return folder;
}

function findAgentMigrationsFolder(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.AGENTD_MIGRATIONS_DIR ?? env.AGENT_MIGRATIONS_DIR;
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const executableDirectory = dirname(process.execPath);
  const candidates = [
    configured ? resolve(process.cwd(), configured) : undefined,
    join(moduleDirectory, "../drizzle"),
    join(executableDirectory, "migrations"),
    join(process.cwd(), "packages/persistence/drizzle"),
    join(process.cwd(), "drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(join(candidate, "meta", "_journal.json")));
}

function materializeEmbeddedMigrations(): string {
  const digest = createHash("sha256")
    .update(embeddedMigrationFiles.map((file) => `${file.path}\0${file.contents}`).join("\0"))
    .digest("hex")
    .slice(0, 16);
  const migrationsFolder = join(tmpdir(), "mobile-agent", "migrations", digest);
  for (const file of embeddedMigrationFiles) {
    const target = join(migrationsFolder, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (!existsSync(target) || readFileSync(target, "utf8") !== file.contents) {
      writeFileSync(target, file.contents, { mode: 0o600 });
    }
  }
  return migrationsFolder;
}

export class DrizzlePaneRepository implements PaneRepository {
  public constructor(private readonly database: AgentDatabase["db"]) {}

  public async list(filter?: PaneFilter): Promise<PaneRecord[]> {
    const conditions = [];
    if (filter?.state) conditions.push(eq(panes.state, filter.state));
    if (filter?.kind) conditions.push(eq(panes.kind, filter.kind));
    if (filter?.sessionName) conditions.push(eq(panes.sessionName, filter.sessionName));

    const rows = conditions.length
      ? this.database.select().from(panes).where(and(...conditions)).all()
      : this.database.select().from(panes).all();
    return rows.map(toPaneRecord);
  }

  public async findById(id: string): Promise<PaneRecord | undefined> {
    const row = this.database.select().from(panes).where(eq(panes.id, id)).get();
    return row ? toPaneRecord(row) : undefined;
  }

  public async findByTmuxPaneId(tmuxPaneId: string): Promise<PaneRecord | undefined> {
    const row = this.database
      .select()
      .from(panes)
      .where(eq(panes.tmuxPaneId, tmuxPaneId))
      .orderBy(desc(panes.updatedAt))
      .get();
    return row ? toPaneRecord(row) : undefined;
  }

  public async findByTmuxPaneIdentity(tmuxServerId: string, tmuxPaneId: string): Promise<PaneRecord | undefined> {
    const row = this.database
      .select()
      .from(panes)
      .where(and(eq(panes.tmuxServerId, tmuxServerId), eq(panes.tmuxPaneId, tmuxPaneId)))
      .get();
    return row ? toPaneRecord(row) : undefined;
  }

  public async upsert(record: PaneRecord): Promise<void> {
    const now = new Date().toISOString();
    const row = toPaneRow(record, now);
    this.database
      .insert(panes)
      .values(row)
      .onConflictDoUpdate({
        target: [panes.tmuxServerId, panes.tmuxPaneId],
        set: {
          tmuxPaneId: row.tmuxPaneId,
          tmuxServerId: row.tmuxServerId,
          agentSessionId: row.agentSessionId,
          agentExecutionId: row.agentExecutionId,
          sessionName: row.sessionName,
          windowId: row.windowId,
          kind: row.kind,
          name: row.name,
          cwd: row.cwd,
          workspaceId: row.workspaceId,
          agentId: row.agentId,
          runId: row.runId,
          state: row.state,
          title: row.title,
          lastSeenAt: row.lastSeenAt,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }

  public async pruneStalePanes(activePaneIds: readonly string[], olderThan: string, tmuxServerScope: string): Promise<number> {
    // An empty live set is deliberately not treated as authoritative. tmux
    // exits its server after the last session disappears, so deleting all old
    // rows here would turn a temporary tmux outage into data loss.
    if (activePaneIds.length === 0) return 0;

    const condition = and(
      lt(panes.lastSeenAt, olderThan),
      notInArray(panes.id, [...activePaneIds]),
      or(eq(panes.tmuxServerId, "legacy"), like(panes.tmuxServerId, `${tmuxServerScope}:%`)),
    );
    const candidates = this.database.select({ id: panes.id }).from(panes).where(condition).all();
    this.database.delete(panes).where(condition).run();
    return candidates.length;
  }
}

export class DrizzleRunRepository implements RunRepository {
  public constructor(private readonly database: AgentDatabase["db"]) {}

  public async findById(id: string): Promise<RunRecord | undefined> {
    const row = this.database.select().from(runs).where(eq(runs.id, id)).get();
    return row ? toRunRecord(row) : undefined;
  }

  public async upsert(record: RunRecord): Promise<void> {
    const now = new Date().toISOString();
    this.database
      .insert(runs)
      .values({
        id: record.id,
        paneId: record.paneId,
        agentId: record.agentId,
        profileId: record.profileId,
        state: record.state,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: runs.id,
        set: {
          paneId: record.paneId,
          agentId: record.agentId,
          profileId: record.profileId,
          state: record.state,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          updatedAt: now,
        },
      })
      .run();
  }
}

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  public constructor(private readonly database: AgentDatabase["db"]) {}

  public async findById(id: string): Promise<WorkspaceRecord | undefined> {
    const row = this.database.select().from(workspaces).where(eq(workspaces.id, id)).get();
    return row ? toWorkspaceRecord(row) : undefined;
  }

  public async list(): Promise<WorkspaceRecord[]> {
    return this.database.select().from(workspaces).orderBy(asc(workspaces.name)).all().map(toWorkspaceRecord);
  }

  public async insert(record: WorkspaceRecord): Promise<boolean> {
    const inserted = this.database
      .insert(workspaces)
      .values(toWorkspaceRow(record, new Date().toISOString()))
      .onConflictDoNothing({ target: workspaces.id })
      .returning({ id: workspaces.id })
      .all();
    return inserted.length > 0;
  }

  public async upsert(record: WorkspaceRecord): Promise<void> {
    const now = new Date().toISOString();
    this.database
      .insert(workspaces)
      .values(toWorkspaceRow(record, now))
      .onConflictDoUpdate({
        target: workspaces.id,
        set: {
          rootPath: record.rootPath,
          name: record.name,
          isGit: record.isGit,
          setupScriptPath: record.setupScriptPath,
          cleanupScriptPath: record.cleanupScriptPath,
          worktreeCopyPatterns: JSON.stringify(record.worktreeCopyPatterns),
          updatedAt: now,
        },
      })
      .run();
  }

  public async delete(id: string): Promise<void> {
    this.database.delete(workspaces).where(eq(workspaces.id, id)).run();
  }
}

export class DrizzleAgentSessionRepository implements AgentSessionRepository {
  public constructor(private readonly database: AgentDatabase["db"]) {}

  public async findById(id: string): Promise<AgentSessionRecord | undefined> {
    const row = this.database.select().from(agentSessions).where(eq(agentSessions.id, id)).get();
    return row ? toAgentSessionRecord(row) : undefined;
  }

  public async findByName(workspaceId: string, name: string): Promise<AgentSessionRecord | undefined> {
    const row = this.database
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.workspaceId, workspaceId), eq(agentSessions.name, name)))
      .get();
    return row ? toAgentSessionRecord(row) : undefined;
  }

  public async list(workspaceId?: string): Promise<AgentSessionRecord[]> {
    const rows = workspaceId
      ? this.database.select().from(agentSessions).where(eq(agentSessions.workspaceId, workspaceId)).orderBy(asc(agentSessions.name)).all()
      : this.database.select().from(agentSessions).orderBy(asc(agentSessions.workspaceName), asc(agentSessions.name)).all();
    return rows.map(toAgentSessionRecord);
  }

  public async insert(record: AgentSessionRecord): Promise<void> {
    const now = new Date().toISOString();
    this.database.insert(agentSessions).values(toAgentSessionRow(record, now)).run();
  }

  public async update(record: AgentSessionRecord): Promise<void> {
    const now = new Date().toISOString();
    this.database
      .update(agentSessions)
      .set({
        name: record.name,
        backend: record.backend,
        status: record.status,
        workspaceId: record.workspaceId,
        workspaceRoot: record.workspaceRoot,
        workspaceName: record.workspaceName,
        worktreeRoot: record.worktreeRoot,
        worktreePath: record.worktreePath,
        branch: record.branch,
        baseCommit: record.baseCommit,
        useWorktree: record.useWorktree,
        setupHook: record.setupHook,
        cleanupHook: record.cleanupHook,
        setupOutputFile: record.setupOutputFile,
        cleanupOutputFile: record.cleanupOutputFile,
        backendSessionId: record.backendSessionId,
        codexProfile: record.codexProfile,
        codexRemote: record.codexRemote,
        setupRan: record.setupRan,
        resuming: record.resuming,
        baselineStatus: record.baselineStatus,
        codexSessionBaseline: record.codexSessionBaseline,
        lastExitStatus: record.lastExitStatus,
        executionId: record.executionId ?? null,
        executionPid: record.executionPid ?? null,
        executionStartedAt: record.executionStartedAt ?? null,
        updatedAt: now,
      })
      .where(eq(agentSessions.id, record.id))
      .run();
  }

  public async claimExecution(id: string, expectedExecutionPid: number | null, executionId: string, executionPid: number, executionStartedAt: string): Promise<boolean> {
    const predicate = expectedExecutionPid === null
      ? and(eq(agentSessions.id, id), isNull(agentSessions.executionPid))
      : and(eq(agentSessions.id, id), eq(agentSessions.executionPid, expectedExecutionPid));
    const result = this.database
      .update(agentSessions)
      .set({ executionId, executionPid, executionStartedAt, status: "resuming", resuming: true, updatedAt: new Date().toISOString() })
      .where(predicate)
      .returning({ id: agentSessions.id })
      .all();
    return result.length > 0;
  }

  public async setBackendSessionIdIfMissing(id: string, backendSessionId: string): Promise<boolean> {
    const result = this.database
      .update(agentSessions)
      .set({ backendSessionId, updatedAt: new Date().toISOString() })
      .where(and(eq(agentSessions.id, id), isNull(agentSessions.backendSessionId)))
      .returning({ id: agentSessions.id })
      .all();
    return result.length > 0;
  }

  public async delete(id: string): Promise<void> {
    this.database.delete(agentSessions).where(eq(agentSessions.id, id)).run();
  }
}

export function recordAuditEvent(
  database: AgentDatabase["db"],
  event: { eventType: string; entityId: string; payload: unknown; occurredAt?: string },
): void {
  database
    .insert(auditEvents)
    .values({
      eventType: event.eventType,
      entityId: event.entityId,
      payload: JSON.stringify(event.payload),
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    })
    .run();
}

const legacyTableNames = ["panes", "runs", "audit_events", "workspaces", "agent_sessions"] as const;

function baselineLegacyDatabase(sqlite: Database, migrationsFolder: string): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  const initialMigration = migrations[0];
  if (!initialMigration) throw new Error(`no migrations found in ${migrationsFolder}`);

  const rows = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  const existingTables = new Set(rows.map((row) => row.name));
  if (existingTables.has("__drizzle_migrations")) return;

  const legacyTables = legacyTableNames.filter((tableName) => existingTables.has(tableName));
  if (legacyTables.length === 0) return;
  if (legacyTables.length !== legacyTableNames.length) {
    throw new Error(`database has a partial legacy schema; refusing to baseline (${legacyTables.join(", ")})`);
  }

  ensureColumn(sqlite, "workspaces", "setup_script_path", "TEXT");
  ensureColumn(sqlite, "workspaces", "cleanup_script_path", "TEXT");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  sqlite
    .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
    .run(initialMigration.hash, initialMigration.folderMillis);
}

function ensureAuthSchema(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_metadata (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      server_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_devices (
      device_id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      public_key_jwk TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      platform TEXT,
      client_version TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_devices_status_index ON auth_devices (status);
    CREATE TABLE IF NOT EXISTS auth_pairings (
      pairing_id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      web_origin TEXT NOT NULL,
      agentd_base_url TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      claim_token_hash TEXT UNIQUE,
      status TEXT NOT NULL,
      offered_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claim_expires_at TEXT,
      claimed_at TEXT,
      approved_at TEXT,
      pending_public_key_jwk TEXT,
      pending_fingerprint TEXT,
      pending_display_name TEXT,
      pending_device_type TEXT,
      pending_platform TEXT,
      pending_client_version TEXT,
      device_id TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_pairings_status_index ON auth_pairings (status);
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_device_index ON auth_sessions (device_id);
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry_index ON auth_sessions (expires_at);
  `);
}

function ensureColumn(sqlite: Database, table: string, column: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function toPaneRow(record: PaneRecord, now: string): typeof panes.$inferInsert {
  return {
    id: record.id,
    tmuxPaneId: record.tmuxPaneId,
    tmuxServerId: record.tmuxServerId ?? "legacy",
    agentSessionId: record.agentSessionId ?? null,
    agentExecutionId: record.agentExecutionId ?? null,
    sessionName: record.sessionName,
    windowId: record.windowId,
    kind: record.kind,
    name: record.name,
    cwd: record.cwd,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    runId: record.runId,
    state: record.state,
    title: record.title,
    lastSeenAt: record.lastSeenAt,
    createdAt: now,
    updatedAt: now,
  };
}

function toPaneRecord(row: PaneRow): PaneRecord {
  return {
    id: row.id,
    tmuxPaneId: row.tmuxPaneId,
    ...(row.tmuxServerId === "legacy" ? {} : { tmuxServerId: row.tmuxServerId }),
    ...(row.agentSessionId ? { agentSessionId: row.agentSessionId } : {}),
    ...(row.agentExecutionId ? { agentExecutionId: row.agentExecutionId } : {}),
    sessionName: row.sessionName,
    windowId: row.windowId,
    kind: row.kind,
    name: row.name,
    cwd: row.cwd,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    runId: row.runId,
    state: row.state,
    title: row.title,
    lastSeenAt: row.lastSeenAt,
  };
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    paneId: row.paneId,
    agentId: row.agentId,
    profileId: row.profileId,
    state: row.state,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

function toWorkspaceRow(record: WorkspaceRecord, now: string): typeof workspaces.$inferInsert {
  return {
    id: record.id,
    rootPath: record.rootPath,
    name: record.name,
    isGit: record.isGit,
    setupScriptPath: record.setupScriptPath,
    cleanupScriptPath: record.cleanupScriptPath,
    worktreeCopyPatterns: JSON.stringify(record.worktreeCopyPatterns),
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
}

function toWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    rootPath: row.rootPath,
    name: row.name,
    isGit: row.isGit,
    setupScriptPath: row.setupScriptPath,
    cleanupScriptPath: row.cleanupScriptPath,
    worktreeCopyPatterns: parseWorktreeCopyPatterns(row.worktreeCopyPatterns),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseWorktreeCopyPatterns(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function toAgentSessionRow(record: AgentSessionRecord, now: string): typeof agentSessions.$inferInsert {
  return {
    id: record.id,
    name: record.name,
    backend: record.backend,
    status: record.status,
    workspaceId: record.workspaceId,
    workspaceRoot: record.workspaceRoot,
    workspaceName: record.workspaceName,
    worktreeRoot: record.worktreeRoot,
    worktreePath: record.worktreePath,
    branch: record.branch,
    baseCommit: record.baseCommit,
    useWorktree: record.useWorktree,
    setupHook: record.setupHook,
    cleanupHook: record.cleanupHook,
    setupOutputFile: record.setupOutputFile,
    cleanupOutputFile: record.cleanupOutputFile,
    backendSessionId: record.backendSessionId,
    codexProfile: record.codexProfile,
    codexRemote: record.codexRemote,
    setupRan: record.setupRan,
    resuming: record.resuming,
    baselineStatus: record.baselineStatus,
    codexSessionBaseline: record.codexSessionBaseline,
    lastExitStatus: record.lastExitStatus,
    executionId: record.executionId ?? null,
    executionPid: record.executionPid ?? null,
    executionStartedAt: record.executionStartedAt ?? null,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
}

function toAgentSessionRecord(row: AgentSessionRow): AgentSessionRecord {
  return {
    id: row.id,
    name: row.name,
    backend: row.backend,
    status: row.status,
    workspaceId: row.workspaceId,
    workspaceRoot: row.workspaceRoot,
    workspaceName: row.workspaceName,
    worktreeRoot: row.worktreeRoot,
    worktreePath: row.worktreePath,
    branch: row.branch,
    baseCommit: row.baseCommit,
    useWorktree: row.useWorktree,
    setupHook: row.setupHook,
    cleanupHook: row.cleanupHook,
    setupOutputFile: row.setupOutputFile,
    cleanupOutputFile: row.cleanupOutputFile,
    backendSessionId: row.backendSessionId,
    codexProfile: row.codexProfile,
    codexRemote: row.codexRemote,
    setupRan: row.setupRan,
    resuming: row.resuming,
    baselineStatus: row.baselineStatus,
    codexSessionBaseline: row.codexSessionBaseline,
    lastExitStatus: row.lastExitStatus,
    ...(row.executionId ? { executionId: row.executionId } : {}),
    ...(row.executionPid === null ? {} : { executionPid: row.executionPid }),
    ...(row.executionStartedAt ? { executionStartedAt: row.executionStartedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
