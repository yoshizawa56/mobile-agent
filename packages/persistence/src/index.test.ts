import { describe, expect, it } from "vitest";
import {
  DrizzleAgentSessionRepository,
  DrizzlePaneRepository,
  DrizzleRunRepository,
  DrizzleWorkspaceRepository,
  createAgentDatabase,
  recordAuditEvent,
} from "./index.js";
import type { AgentSessionRecord, PaneRecord, RunRecord, WorkspaceRecord } from "@mobile-agent/domain";

const pane: PaneRecord = {
  id: "pane-1",
  tmuxPaneId: "%1",
  sessionName: "agentd",
  windowId: "@0",
  kind: "agent",
  name: "review",
  cwd: "/work/repo",
  workspaceId: "workspace-1",
  agentId: "codex",
  runId: "run-1",
  state: "waiting_input",
  title: "Review changes",
  lastSeenAt: "2026-08-09T00:00:00.000Z",
};

const run: RunRecord = {
  id: "run-1",
  paneId: "pane-1",
  agentId: "codex",
  profileId: "mobile-codex",
  state: "waiting_input",
  startedAt: "2026-08-09T00:00:00.000Z",
  endedAt: null,
};

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  rootPath: "/work/repo",
  name: "repo",
  isGit: true,
  setupScriptPath: "/config/hooks/setup",
  cleanupScriptPath: "/config/hooks/cleanup",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

const session: AgentSessionRecord = {
  id: "session-1",
  name: "review",
  backend: "codex",
  status: "running",
  workspaceId: "workspace-1",
  workspaceRoot: "/work/repo",
  workspaceName: "repo",
  worktreeRoot: "/work/repo.worktrees",
  worktreePath: "/work/repo.worktrees/review",
  branch: "agent/review",
  baseCommit: "abc123",
  useWorktree: true,
  setupHook: workspace.setupScriptPath,
  cleanupHook: workspace.cleanupScriptPath,
  setupOutputFile: "/state/setup.log",
  cleanupOutputFile: null,
  backendSessionId: "codex-session",
  codexProfile: "local-agent",
  codexRemote: "unix://",
  setupRan: true,
  resuming: false,
  baselineStatus: "",
  codexSessionBaseline: JSON.stringify({ codexSessions: [] }),
  lastExitStatus: null,
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

describe("sqlite persistence", () => {
  it("round-trips panes, runs and audit events", async () => {
    const database = createAgentDatabase();
    try {
      const panes = new DrizzlePaneRepository(database.db);
      const runs = new DrizzleRunRepository(database.db);
      const workspaces = new DrizzleWorkspaceRepository(database.db);
      const sessions = new DrizzleAgentSessionRepository(database.db);
      await panes.upsert(pane);
      await runs.upsert(run);
      await workspaces.upsert(workspace);
      await sessions.insert(session);
      recordAuditEvent(database.db, {
        eventType: "run.waiting",
        entityId: run.id,
        payload: { state: run.state },
        occurredAt: "2026-08-09T00:01:00.000Z",
      });

      await expect(panes.list({ state: "waiting_input" })).resolves.toEqual([pane]);
      await expect(panes.findById(pane.id)).resolves.toEqual(pane);
      await expect(runs.findById(run.id)).resolves.toEqual(run);
      await expect(workspaces.findById(workspace.id)).resolves.toMatchObject({
        id: workspace.id,
        rootPath: workspace.rootPath,
        name: workspace.name,
        isGit: workspace.isGit,
        setupScriptPath: workspace.setupScriptPath,
        cleanupScriptPath: workspace.cleanupScriptPath,
      });
      await expect(sessions.findByName(workspace.id, session.name)).resolves.toMatchObject({
        id: session.id,
        name: session.name,
        backend: session.backend,
        status: session.status,
        workspaceId: session.workspaceId,
        worktreePath: session.worktreePath,
        backendSessionId: session.backendSessionId,
        codexSessionBaseline: session.codexSessionBaseline,
      });
      expect(database.db.select().from(databaseTable(database)).all()).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});

function databaseTable(database: ReturnType<typeof createAgentDatabase>) {
  // Keep the test's audit assertion independent from private DatabaseSync
  // internals while still verifying the event was persisted.
  return databaseTableSchema;
}

import { auditEvents as databaseTableSchema } from "./schema.js";
