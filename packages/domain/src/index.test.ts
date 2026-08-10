import { describe, expect, it } from "vitest";
import { canTransitionRunState, isAttentionState, paneKindForCommand, transitionRunState } from "./index.js";

type TableCase = {
  name: string;
  given: () => { from: Parameters<typeof canTransitionRunState>[0]; to: Parameters<typeof canTransitionRunState>[1] };
  when: (input: ReturnType<TableCase["given"]>) => boolean;
  check: Array<(ctx: { result?: boolean; error?: unknown }) => void>;
  assert: Array<(ctx: { result?: boolean; error?: unknown }) => void>;
};

const cases: TableCase[] = [
  {
    name: "allows a running agent to wait for input",
    given: () => ({ from: "running", to: "waiting_input" }),
    when: ({ from, to }) => canTransitionRunState(from, to),
    check: [(ctx) => expect(ctx.result).toBe(true)],
    assert: [],
  },
  {
    name: "rejects a transition after completion",
    given: () => ({ from: "completed", to: "running" }),
    when: ({ from, to }) => canTransitionRunState(from, to),
    check: [(ctx) => expect(ctx.result).toBe(false)],
    assert: [],
  },
];

describe("run state domain rules", () => {
  it.each(cases)("$name", ({ given, when, check, assert }) => {
    const ctx: { result?: boolean; error?: unknown } = {};
    try {
      ctx.result = when(given());
    } catch (error) {
      ctx.error = error;
    }
    check.forEach((checkCase) => checkCase(ctx));
    assert.forEach((assertCase) => assertCase(ctx));
  });

  it("returns a transition record for an allowed change", () => {
    expect(transitionRunState("running", "waiting_approval", "agent asked for approval", "2026-08-09T00:00:00.000Z"))
      .toEqual({
        from: "running",
        to: "waiting_approval",
        reason: "agent asked for approval",
        at: "2026-08-09T00:00:00.000Z",
      });
  });

  it("classifies attention states and ordinary shells", () => {
    expect(isAttentionState("waiting_input")).toBe(true);
    expect(isAttentionState("running")).toBe(false);
    expect(paneKindForCommand("/bin/zsh -l")).toBe("shell");
    expect(paneKindForCommand("zsh")).toBe("shell");
    expect(paneKindForCommand("codex --profile local-agent")).toBe("agent");
    expect(paneKindForCommand("claude --session-id example")).toBe("agent");
  });
});
