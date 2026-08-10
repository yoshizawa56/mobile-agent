import { z } from "zod";

export const protocolVersion = 1 as const;

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
  }),
});
export type AgentdCapabilities = z.infer<typeof agentdCapabilitiesSchema>;

const dimensionsSchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(300),
});

export const clientControlMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("attach"),
    target: z.string().min(1).max(256),
    ...dimensionsSchema.shape,
  }),
  z.object({
    type: z.literal("resize"),
    ...dimensionsSchema.shape,
  }),
  z.object({
    type: z.literal("detach"),
  }),
  z.object({
    type: z.literal("claim"),
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
  projectId: z.string().nullable(),
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
  cwd: z.string().trim().min(1).max(4_096),
  agentId: z.enum(["codex", "claude"]).nullable(),
  useWorktree: z.boolean(),
  projectName: z.string().trim().min(1).max(64).nullable(),
  placement: panePlacementSchema,
  targetPaneId: z.string().trim().min(1).max(64).nullable(),
}).superRefine((value, context) => {
  if (value.kind === "agent" && !value.agentId) {
    context.addIssue({ code: "custom", path: ["agentId"], message: "agentId is required for an agent pane" });
  }
  if (value.kind === "shell" && value.agentId) {
    context.addIssue({ code: "custom", path: ["agentId"], message: "agentId is not allowed for a shell pane" });
  }
  if (!value.useWorktree && value.projectName) {
    context.addIssue({ code: "custom", path: ["projectName"], message: "projectName requires useWorktree" });
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
  project: z.string().min(1),
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
  cwd: z.string().trim().min(1).max(4_096),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionResponseSchema = z.object({ session: tmuxSessionSchema });

export const serverControlMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    target: z.string(),
    paneId: z.string(),
    windowId: z.string(),
    ...dimensionsSchema.shape,
  }),
  z.object({
    type: z.literal("viewport"),
    owner: z.enum(["mobile", "desktop"]),
    reason: z.enum(["attached", "mobile_claim", "desktop_activity", "desktop_resize", "desktop_focus", "detached"]),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("closed"),
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
]);

export type ServerControlMessage = z.infer<typeof serverControlMessageSchema>;
