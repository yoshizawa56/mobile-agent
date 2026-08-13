import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const panes = sqliteTable(
  "panes",
  {
    id: text("id").primaryKey(),
    tmuxPaneId: text("tmux_pane_id").notNull(),
    sessionName: text("session_name").notNull(),
    windowId: text("window_id").notNull(),
    kind: text("kind", { enum: ["agent", "shell", "unknown"] }).notNull(),
    name: text("name").notNull(),
    cwd: text("cwd").notNull(),
    workspaceId: text("workspace_id"),
    agentId: text("agent_id"),
    runId: text("run_id"),
    state: text("state", {
      enum: ["starting", "running", "waiting_input", "waiting_approval", "failed", "completed", "stopped"],
    }).notNull(),
    title: text("title"),
    lastSeenAt: text("last_seen_at").notNull(),
    ...timestamps,
  },
  (table) => ({
    tmuxPaneIndex: uniqueIndex("panes_tmux_pane_id_index").on(table.tmuxPaneId),
  }),
);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  paneId: text("pane_id").notNull(),
  agentId: text("agent_id"),
  profileId: text("profile_id"),
  state: text("state", {
    enum: ["starting", "running", "waiting_input", "waiting_approval", "failed", "completed", "stopped"],
  }).notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  ...timestamps,
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: text("payload").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  rootPath: text("root_path").notNull(),
  name: text("name").notNull(),
  isGit: integer("is_git", { mode: "boolean" }).notNull(),
  setupScriptPath: text("setup_script_path"),
  cleanupScriptPath: text("cleanup_script_path"),
  worktreeCopyPatterns: text("worktree_copy_patterns").notNull().default("[]"),
  ...timestamps,
});

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    backend: text("backend", { enum: ["codex", "claude"] }).notNull(),
    status: text("status", {
      enum: ["starting", "setup", "setup_failed", "ready", "running", "resuming", "interrupted", "exited"],
    }).notNull(),
    workspaceId: text("workspace_id").notNull(),
    workspaceRoot: text("workspace_root").notNull(),
    workspaceName: text("workspace_name").notNull(),
    worktreeRoot: text("worktree_root"),
    worktreePath: text("worktree_path"),
    branch: text("branch"),
    baseCommit: text("base_commit"),
    useWorktree: integer("use_worktree", { mode: "boolean" }).notNull(),
    setupHook: text("setup_hook"),
    cleanupHook: text("cleanup_hook"),
    setupOutputFile: text("setup_output_file"),
    cleanupOutputFile: text("cleanup_output_file"),
    backendSessionId: text("backend_session_id"),
    codexProfile: text("codex_profile"),
    codexRemote: text("codex_remote"),
    setupRan: integer("setup_ran", { mode: "boolean" }).notNull(),
    resuming: integer("resuming", { mode: "boolean" }).notNull(),
    baselineStatus: text("baseline_status"),
    codexSessionBaseline: text("codex_session_baseline"),
    lastExitStatus: integer("last_exit_status"),
    ...timestamps,
  },
  (table) => ({
    workspaceNameIndex: uniqueIndex("agent_sessions_workspace_name_index").on(table.workspaceId, table.name),
    workspaceIndex: index("agent_sessions_workspace_index").on(table.workspaceId),
  }),
);

export type PaneRow = typeof panes.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
