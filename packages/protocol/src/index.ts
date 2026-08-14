import { z } from "zod";

export const protocolVersion = 1 as const;
export const terminalProtocolVersion = protocolVersion;

export const agentdHealthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("agentd"),
  protocolVersion: z.number().int().positive(),
});
export type AgentdHealth = z.infer<typeof agentdHealthSchema>;

export const agentdCapabilitiesSchema = z.object({
  protocolVersion: z.number().int().positive(),
  features: z.object({
    tmuxSessions: z.boolean(),
    terminalWebSocket: z.boolean(),
    paneState: z.boolean(),
    resourceInvalidationEvents: z.boolean(),
  }),
});
export type AgentdCapabilities = z.infer<typeof agentdCapabilitiesSchema>;

export const agentdEventSchema = z.object({
  type: z.literal("session_updated"),
  sessionName: z.string().min(1),
  reason: z.enum(["pane_created", "pane_deleted", "pane_changed"]),
  revision: z.number().int().nonnegative(),
});
export type AgentdEvent = z.infer<typeof agentdEventSchema>;

export const workspaceSelectionModeSchema = z.enum(["workspace", "worktree"]);
export type WorkspaceSelectionMode = z.infer<typeof workspaceSelectionModeSchema>;

export const workspaceDirectorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  directory: z.string().min(1),
  isGit: z.boolean(),
  setupScriptPath: z.string().min(1).nullable(),
  cleanupScriptPath: z.string().min(1).nullable(),
  worktreeCopyPatterns: z.array(z.string().min(1).max(4_096)).max(100).default([]),
});
export type WorkspaceDirectory = z.infer<typeof workspaceDirectorySchema>;

export const workspaceListResponseSchema = z.object({ workspaces: z.array(workspaceDirectorySchema) });

export const workspaceBrowseResponseSchema = z.object({ directories: z.array(workspaceDirectorySchema) });

export const registerWorkspaceRequestSchema = z.object({
  directory: z.string().trim().min(1).max(4_096),
  name: z.string().trim().min(1).max(120).optional(),
  setupScriptPath: z.string().trim().min(1).max(4_096).nullable().optional(),
  cleanupScriptPath: z.string().trim().min(1).max(4_096).nullable().optional(),
  worktreeCopyPatterns: z.array(z.string().trim().min(1).max(4_096)).max(100).optional(),
});
export type RegisterWorkspaceRequest = z.infer<typeof registerWorkspaceRequestSchema>;

export const workspaceResponseSchema = z.object({ workspace: workspaceDirectorySchema });

export const workspaceSelectionSchema = z.object({
  workspaceId: z.string().trim().min(1).max(256),
  mode: workspaceSelectionModeSchema,
});
export type WorkspaceSelection = z.infer<typeof workspaceSelectionSchema>;

const dimensionsSchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(300),
});

const terminalFrameVersionSchema = z.object({
  version: z.literal(terminalProtocolVersion),
});

const terminalSessionIdSchema = z.string().min(1).max(128);
const terminalResumeTokenSchema = z.string().min(1).max(256);

const terminalAttachMessageSchema = z.object({
  type: z.literal("attach"),
  ...terminalFrameVersionSchema.shape,
  target: z.string().min(1).max(256),
  ...dimensionsSchema.shape,
  sessionId: terminalSessionIdSchema.optional(),
  resumeToken: terminalResumeTokenSchema.optional(),
}).superRefine((value, context) => {
  if ((value.sessionId === undefined) !== (value.resumeToken === undefined)) {
    context.addIssue({
      code: "custom",
      path: [value.sessionId === undefined ? "sessionId" : "resumeToken"],
      message: "sessionId and resumeToken must be provided together",
    });
  }
});

export const clientControlMessageSchema = z.discriminatedUnion("type", [
  terminalAttachMessageSchema,
  z.object({
    type: z.literal("resize"),
    ...terminalFrameVersionSchema.shape,
    ...dimensionsSchema.shape,
  }),
  z.object({
    type: z.literal("detach"),
    ...terminalFrameVersionSchema.shape,
    sessionId: terminalSessionIdSchema.optional(),
  }),
  z.object({
    type: z.literal("claim"),
    ...terminalFrameVersionSchema.shape,
  }),
]);

export type ClientControlMessage = z.infer<typeof clientControlMessageSchema>;

export const paneSummarySchema = z.object({
  id: z.string(),
  tmuxPaneId: z.string(),
  sessionName: z.string(),
  windowId: z.string(),
  kind: z.enum(["agent", "shell", "unknown"]),
  name: z.string(),
  cwd: z.string(),
  workspaceId: z.string().nullable(),
  agentId: z.string().nullable(),
  runId: z.string().nullable(),
  state: z.enum(["starting", "running", "waiting_input", "waiting_approval", "failed", "completed", "stopped"]),
  title: z.string().nullable(),
  lastSeenAt: z.string(),
  // Present for live tmux snapshots. Older persisted rows may omit geometry;
  // the client falls back to a readable stacked layout in that case.
  windowName: z.string().optional(),
  windowIndex: z.number().int().min(0).optional(),
  // Pane indexes are scoped to a tmux window and are distinct from tmuxPaneId
  // (the server-wide target such as %32).
  paneIndex: z.number().int().min(0).optional(),
  left: z.number().int().min(0).optional(),
  top: z.number().int().min(0).optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
  windowWidth: z.number().int().min(1).optional(),
  windowHeight: z.number().int().min(1).optional(),
});

export const paneListResponseSchema = z.object({ panes: z.array(paneSummarySchema) });
export type PaneSummary = z.infer<typeof paneSummarySchema>;

export const panePlacementSchema = z.enum(["window", "right", "bottom"]);
export type PanePlacement = z.infer<typeof panePlacementSchema>;

export const createPaneRequestSchema = z.object({
  sessionName: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
  kind: z.enum(["agent", "shell"]),
  name: z.string().trim().min(1).max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "name contains a control character"),
  // cwd remains readable for older clients, but new clients select a stable
  // workspaceId and agentd resolves it through its allowed-root policy.
  cwd: z.string().trim().min(1).max(4_096).optional(),
  workspaceId: z.string().trim().min(1).max(256).optional(),
  agentId: z.enum(["codex", "claude"]).nullable(),
  useWorktree: z.boolean(),
  placement: panePlacementSchema,
  targetPaneId: z.string().trim().min(1).max(64).nullable(),
}).superRefine((value, context) => {
  if (!value.cwd && !value.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "workspaceId or cwd is required" });
  }
  if (value.cwd && value.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "choose workspaceId instead of cwd" });
  }
  if (value.kind === "agent" && !value.agentId) {
    context.addIssue({ code: "custom", path: ["agentId"], message: "agentId is required for an agent pane" });
  }
  if (value.kind === "shell" && value.agentId) {
    context.addIssue({ code: "custom", path: ["agentId"], message: "agentId is not allowed for a shell pane" });
  }
  if (value.kind === "shell" && value.useWorktree) {
    context.addIssue({ code: "custom", path: ["useWorktree"], message: "useWorktree is only allowed for an agent pane" });
  }
  if (value.placement === "window" && value.targetPaneId) {
    context.addIssue({ code: "custom", path: ["targetPaneId"], message: "targetPaneId is only used for a split pane" });
  }
  if (value.placement !== "window" && !value.targetPaneId) {
    context.addIssue({ code: "custom", path: ["targetPaneId"], message: "targetPaneId is required for a split pane" });
  }
});
export type CreatePaneRequest = z.infer<typeof createPaneRequestSchema>;

export const paneResponseSchema = z.object({ pane: paneSummarySchema });

export const terminalEndpointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  tailnetIp: z.string().min(1),
  state: z.enum(["online", "offline"]),
  detail: z.string(),
  lastSeen: z.string(),
});
export type TerminalEndpoint = z.infer<typeof terminalEndpointSchema>;

export const terminalListResponseSchema = z.object({ terminals: z.array(terminalEndpointSchema) });

export const tmuxSessionSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().min(1),
  cwd: z.string().min(1),
  paneCount: z.number().int().min(0),
  waitingCount: z.number().int().min(0),
  detail: z.string(),
  state: z.enum(["active", "idle"]),
});
export type TmuxSession = z.infer<typeof tmuxSessionSchema>;

export const sessionListResponseSchema = z.object({ sessions: z.array(tmuxSessionSchema) });

export const createSessionRequestSchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
  // cwd is accepted only as a compatibility input. The web flow always sends
  // workspaceId, which is resolved on the host before tmux is touched.
  cwd: z.string().trim().min(1).max(4_096).optional(),
  workspaceId: z.string().trim().min(1).max(256).optional(),
}).superRefine((value, context) => {
  if (!value.cwd && !value.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "workspaceId or cwd is required" });
  }
  if (value.cwd && value.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "choose workspaceId instead of cwd" });
  }
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionResponseSchema = z.object({ session: tmuxSessionSchema });

export const serverControlMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    ...terminalFrameVersionSchema.shape,
    sessionId: terminalSessionIdSchema,
    resumeToken: terminalResumeTokenSchema,
    resumed: z.boolean(),
    target: z.string(),
    paneId: z.string(),
    windowId: z.string(),
    ...dimensionsSchema.shape,
  }),
  z.object({
    type: z.literal("viewport"),
    ...terminalFrameVersionSchema.shape,
    owner: z.enum(["mobile", "desktop"]),
    reason: z.enum(["attached", "mobile_claim", "desktop_activity", "desktop_resize", "desktop_focus", "detached"]),
  }),
  z.object({
    type: z.literal("error"),
    ...terminalFrameVersionSchema.shape,
    sessionId: terminalSessionIdSchema.optional(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("closed"),
    ...terminalFrameVersionSchema.shape,
    sessionId: terminalSessionIdSchema,
    reason: z.enum(["detached", "terminal_exit", "network_timeout", "server_shutdown"]),
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
]);

export type ServerControlMessage = z.infer<typeof serverControlMessageSchema>;
