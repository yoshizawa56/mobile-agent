import { describe, expect, it } from "vitest";
import { agentdEventSchema, clientControlMessageSchema, createPaneRequestSchema, createSessionRequestSchema, paneListResponseSchema, serverControlMessageSchema, terminalProtocolVersion, workspaceSelectionSchema } from "./index.js";

type TableCase = {
  name: string;
  given: () => unknown;
  when: (input: unknown) => ReturnType<typeof clientControlMessageSchema.safeParse>;
  check: Array<(ctx: { result?: ReturnType<typeof clientControlMessageSchema.safeParse> }) => void>;
  assert: Array<(ctx: { result?: ReturnType<typeof clientControlMessageSchema.safeParse> }) => void>;
};

const cases: TableCase[] = [
  {
    name: "accepts an attach request",
    given: () => ({ type: "attach", version: terminalProtocolVersion, target: "agentd", cols: 80, rows: 24 }),
    when: (input) => clientControlMessageSchema.safeParse(input),
    check: [(ctx) => expect(ctx.result?.success).toBe(true)],
    assert: [(ctx) => expect(ctx.result?.data).toMatchObject({ type: "attach", target: "agentd" })],
  },
  {
    name: "accepts a mobile claim request",
    given: () => ({ type: "claim", version: terminalProtocolVersion }),
    when: (input) => clientControlMessageSchema.safeParse(input),
    check: [(ctx) => expect(ctx.result?.success).toBe(true)],
    assert: [(ctx) => expect(ctx.result?.data).toEqual({ type: "claim", version: terminalProtocolVersion })],
  },
  {
    name: "rejects an invalid terminal size",
    given: () => ({ type: "resize", version: terminalProtocolVersion, cols: 0, rows: 24 }),
    when: (input) => clientControlMessageSchema.safeParse(input),
    check: [(ctx) => expect(ctx.result?.success).toBe(false)],
    assert: [(ctx) => expect(ctx.result?.error?.issues[0]?.path).toEqual(["cols"])],
  },
];

describe("client control protocol", () => {
  it.each(cases)("$name", ({ given, when, check, assert }) => {
    const ctx: { result?: ReturnType<typeof clientControlMessageSchema.safeParse> } = {};
    const input = given();
    ctx.result = when(input);
    check.forEach((checkCase) => checkCase(ctx));
    assert.forEach((assertCase) => assertCase(ctx));
  });
});

describe("server viewport protocol", () => {
  it.each([
    {
      name: "describes the mobile viewport after attach",
      input: {
        type: "ready",
        version: terminalProtocolVersion,
        sessionId: "terminal-1",
        resumeToken: "resume-token",
        resumed: false,
        target: "project:0.1",
        paneId: "%3",
        windowId: "@1",
        cols: 80,
        rows: 24,
      },
    },
    {
      name: "describes a desktop takeover",
      input: {
        type: "viewport",
        version: terminalProtocolVersion,
        owner: "desktop",
        reason: "desktop_activity",
      },
    },
  ])("$name", ({ input }) => {
    expect(serverControlMessageSchema.safeParse(input).success).toBe(true);
  });

  it("accepts a resumed attach with paired credentials", () => {
    expect(clientControlMessageSchema.safeParse({
      type: "attach",
      version: terminalProtocolVersion,
      target: "%3",
      cols: 80,
      rows: 24,
      sessionId: "terminal-1",
      resumeToken: "resume-token",
    }).success).toBe(true);
  });

  it("rejects an attach with only one resume credential", () => {
    expect(clientControlMessageSchema.safeParse({
      type: "attach",
      version: terminalProtocolVersion,
      target: "%3",
      cols: 80,
      rows: 24,
      sessionId: "terminal-1",
    }).success).toBe(false);
  });

  it("requires a lifecycle reason on a closed frame", () => {
    expect(serverControlMessageSchema.safeParse({
      type: "closed",
      version: terminalProtocolVersion,
      sessionId: "terminal-1",
      reason: "detached",
      code: null,
      signal: null,
    }).success).toBe(true);
  });
});

describe("agentd event protocol", () => {
  it.each([
    {
      name: "accepts a pane creation invalidation",
      input: { type: "session_updated", sessionName: "agentd", reason: "pane_created", revision: 1 },
      valid: true,
    },
    {
      name: "rejects an event without a session scope",
      input: { type: "session_updated", reason: "pane_deleted", revision: 2 },
      valid: false,
    },
  ])("$name", ({ input, valid }) => {
    expect(agentdEventSchema.safeParse(input).success).toBe(valid);
  });
});

describe("pane board protocol", () => {
  it("accepts the host pane list DTO", () => {
    expect(
      paneListResponseSchema.safeParse({
        panes: [{
          id: "pane-1",
          tmuxPaneId: "%1",
          sessionName: "agentd",
          windowId: "@0",
          kind: "shell",
          name: "shell",
          cwd: "/tmp",
          projectId: null,
          workspaceId: null,
          agentId: null,
          runId: null,
          state: "running",
          title: null,
          lastSeenAt: "2026-08-09T00:00:00.000Z",
        }],
      }).success,
    ).toBe(true);
  });
});

describe("pane creation protocol", () => {
  it.each([
    {
      name: "allows a new tmux window without a target",
      input: { placement: "window", targetPaneId: null },
      valid: true,
    },
    {
      name: "allows a right split with a target pane",
      input: { placement: "right", targetPaneId: "%0" },
      valid: true,
    },
    {
      name: "rejects a split without a target pane",
      input: { placement: "bottom", targetPaneId: null },
      valid: false,
    },
  ])("$name", ({ input, valid }) => {
    const result = createPaneRequestSchema.safeParse({
      sessionName: "agentd",
      kind: "shell",
      name: "shell",
      cwd: "/tmp",
      agentId: null,
      useWorktree: false,
      projectName: null,
      ...input,
    });
    expect(result.success).toBe(valid);
  });
});

describe("workspace selection protocol", () => {
  it.each([
    {
      name: "accepts a direct workspace selection",
      input: { workspaceId: "workspace-1", mode: "workspace", projectId: null },
      valid: true,
    },
    {
      name: "accepts a project worktree selection",
      input: { workspaceId: "workspace-1", mode: "worktree", projectId: "project-1" },
      valid: true,
    },
    {
      name: "rejects worktree mode without a project",
      input: { workspaceId: "workspace-1", mode: "worktree", projectId: null },
      valid: false,
    },
    {
      name: "rejects a project in direct workspace mode",
      input: { workspaceId: "workspace-1", mode: "workspace", projectId: "project-1" },
      valid: false,
    },
  ])("$name", ({ input, valid }) => {
    expect(workspaceSelectionSchema.safeParse(input).success).toBe(valid);
  });

  it.each([
    { name: "accepts the selected workspace for a new session", input: { name: "review", workspaceId: "workspace-1" }, valid: true },
    { name: "accepts a legacy cwd while clients migrate", input: { name: "review", cwd: "/work/mobile-agent" }, valid: true },
    { name: "rejects a session without a workspace selection", input: { name: "review" }, valid: false },
  ])("$name", ({ input, valid }) => {
    expect(createSessionRequestSchema.safeParse(input).success).toBe(valid);
  });

  it("accepts a pane request that selects a project by id", () => {
    expect(createPaneRequestSchema.safeParse({
      sessionName: "agentd",
      kind: "agent",
      name: "review",
      workspaceId: "workspace-1",
      agentId: "codex",
      useWorktree: true,
      projectId: "project-1",
      projectName: null,
      placement: "window",
      targetPaneId: null,
    }).success).toBe(true);
  });
});
