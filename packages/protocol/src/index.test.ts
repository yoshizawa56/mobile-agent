import { describe, expect, it } from "vitest";
import { clientControlMessageSchema, createPaneRequestSchema, paneListResponseSchema, serverControlMessageSchema } from "./index.js";

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
    given: () => ({ type: "attach", target: "agentd", cols: 80, rows: 24 }),
    when: (input) => clientControlMessageSchema.safeParse(input),
    check: [(ctx) => expect(ctx.result?.success).toBe(true)],
    assert: [(ctx) => expect(ctx.result?.data).toMatchObject({ type: "attach", target: "agentd" })],
  },
  {
    name: "accepts a mobile claim request",
    given: () => ({ type: "claim" }),
    when: (input) => clientControlMessageSchema.safeParse(input),
    check: [(ctx) => expect(ctx.result?.success).toBe(true)],
    assert: [(ctx) => expect(ctx.result?.data).toEqual({ type: "claim" })],
  },
  {
    name: "rejects an invalid terminal size",
    given: () => ({ type: "resize", cols: 0, rows: 24 }),
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
        owner: "desktop",
        reason: "desktop_activity",
      },
    },
  ])("$name", ({ input }) => {
    expect(serverControlMessageSchema.safeParse(input).success).toBe(true);
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
