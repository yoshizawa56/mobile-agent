import { Database } from "bun:sqlite";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type {
  AgentSessionRepository,
  PaneFilter,
  PaneRepository,
  ProjectRepository,
  RunRepository,
  WorkspaceRepository,
} from "@mobile-agent/application";
import type {
  AgentSessionRecord,
  PaneRecord,
  ProjectRecord,
  RunRecord,
  WorkspaceRecord,
} from "@mobile-agent/domain";
import {
  agentSessions,
  auditEvents,
  panes,
  projects,
  runs,
  workspaces,
  type AgentSessionRow,
  type PaneRow,
  type ProjectRow,
  type RunRow,
  type WorkspaceRow,
} from "./schema.js";

export { agentSessions, auditEvents, panes, projects, runs, workspaces } from "./schema.js";

export type AgentDatabase = {
  db: ReturnType<typeof drizzle>;
  sqlite: Database;
  close: () => void;
};

export function defaultAgentDatabaseFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENTD_DB_FILE ?? env.AGENT_DATABASE_FILE ?? joinHomeStatePath(env);
}

export function createAgentDatabase(file = process.env.AGENTD_DB_FILE ?? ":memory:"): AgentDatabase {
  if (file !== ":memory:") mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
  const sqlite = new Database(file);
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  ensureSchema(sqlite);
  const db = drizzle({ client: sqlite });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
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
    const row = this.database.select().from(panes).where(eq(panes.tmuxPaneId, tmuxPaneId)).get();
    return row ? toPaneRecord(row) : undefined;
  }

  public async upsert(record: PaneRecord): Promise<void> {
    const now = new Date().toISOString();
    this.database
      .insert(panes)
      .values(toPaneRow(record, now))
      .onConflictDoUpdate({
        target: panes.id,
        set: toPaneRow(record, now),
      })
      .run();
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
          updatedAt: now,
        },
      })
      .run();
  }
}

export class DrizzleProjectRepository implements ProjectRepository {
  public constructor(private readonly database: AgentDatabase["db"]) {}

  public async findByName(name: string): Promise<ProjectRecord | undefined> {
    const row = this.database.select().from(projects).where(eq(projects.name, name)).get();
    return row ? toProjectRecord(row) : undefined;
  }

  public async list(): Promise<ProjectRecord[]> {
    return this.database.select().from(projects).orderBy(asc(projects.name)).all().map(toProjectRecord);
  }

  public async upsert(record: ProjectRecord): Promise<void> {
    const now = new Date().toISOString();
    this.database
      .insert(projects)
      .values(toProjectRow(record, now))
      .onConflictDoUpdate({
        target: projects.name,
        set: {
          name: record.name,
          directory: record.directory,
          setupHook: record.setupHook,
          cleanupHook: record.cleanupHook,
          updatedAt: now,
        },
      })
      .run();
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
        projectId: record.projectId,
        projectName: record.projectName,
        projectDirectory: record.projectDirectory,
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
        updatedAt: now,
      })
      .where(eq(agentSessions.id, record.id))
      .run();
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

function ensureSchema(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS panes (
      id TEXT PRIMARY KEY NOT NULL,
      tmux_pane_id TEXT NOT NULL,
      session_name TEXT NOT NULL,
      window_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      project_id TEXT,
      workspace_id TEXT,
      agent_id TEXT,
      run_id TEXT,
      state TEXT NOT NULL,
      title TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS panes_tmux_pane_id_index ON panes (tmux_pane_id);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      pane_id TEXT NOT NULL,
      agent_id TEXT,
      profile_id TEXT,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      event_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      root_path TEXT NOT NULL,
      name TEXT NOT NULL,
      is_git INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      directory TEXT NOT NULL,
      setup_hook TEXT,
      cleanup_hook TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_name_index ON projects (name);
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      backend TEXT NOT NULL,
      status TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      worktree_root TEXT,
      worktree_path TEXT,
      branch TEXT,
      base_commit TEXT,
      use_worktree INTEGER NOT NULL,
      project_id TEXT,
      project_name TEXT,
      project_directory TEXT,
      setup_hook TEXT,
      cleanup_hook TEXT,
      setup_output_file TEXT,
      cleanup_output_file TEXT,
      backend_session_id TEXT,
      codex_profile TEXT,
      codex_remote TEXT,
      setup_ran INTEGER NOT NULL,
      resuming INTEGER NOT NULL,
      baseline_status TEXT,
      codex_session_baseline TEXT,
      last_exit_status INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_workspace_name_index ON agent_sessions (workspace_id, name);
    CREATE INDEX IF NOT EXISTS agent_sessions_workspace_index ON agent_sessions (workspace_id);
  `);
}

function joinHomeStatePath(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? homedir();
  return `${home}/.local/state/mobile-agent/agentd.sqlite`;
}

function toPaneRow(record: PaneRecord, now: string): typeof panes.$inferInsert {
  return {
    id: record.id,
    tmuxPaneId: record.tmuxPaneId,
    sessionName: record.sessionName,
    windowId: record.windowId,
    kind: record.kind,
    name: record.name,
    cwd: record.cwd,
    projectId: record.projectId,
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
    sessionName: row.sessionName,
    windowId: row.windowId,
    kind: row.kind,
    name: row.name,
    cwd: row.cwd,
    projectId: row.projectId,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProjectRow(record: ProjectRecord, now: string): typeof projects.$inferInsert {
  return {
    id: record.id,
    name: record.name,
    directory: record.directory,
    setupHook: record.setupHook,
    cleanupHook: record.cleanupHook,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
}

function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    directory: row.directory,
    setupHook: row.setupHook,
    cleanupHook: row.cleanupHook,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
    projectId: record.projectId,
    projectName: record.projectName,
    projectDirectory: record.projectDirectory,
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
    projectId: row.projectId,
    projectName: row.projectName,
    projectDirectory: row.projectDirectory,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
