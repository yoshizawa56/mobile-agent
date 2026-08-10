import { describe, expect, it } from "vitest";
import { classifyTerminalFlick, terminalInputForFlick } from "./terminal-flick";

describe("terminal flick input", () => {
  it.each([
    { name: "right", dx: 72, dy: 3, durationMs: 180, direction: "right" as const, input: "\u001b[C" },
    { name: "left", dx: -72, dy: 3, durationMs: 180, direction: "left" as const, input: "\u001b[D" },
    { name: "up", dx: 2, dy: -72, durationMs: 180, direction: "up" as const, input: "\u001b[A" },
    { name: "down", dx: 2, dy: 72, durationMs: 180, direction: "down" as const, input: "\u001b[B" },
  ])("maps a fast $name flick to an arrow sequence", ({ dx, dy, durationMs, direction, input }) => {
    expect(classifyTerminalFlick({ dx, dy, durationMs })).toBe(direction);
    expect(terminalInputForFlick(direction)).toBe(input);
  });

  it.each([
    { name: "short drag", dx: 12, dy: 0, durationMs: 120 },
    { name: "slow drag", dx: 72, dy: 0, durationMs: 800 },
    { name: "low velocity drag", dx: 28, dy: 0, durationMs: 240 },
  ])("does not treat a $name as a flick", (metrics) => {
    expect(classifyTerminalFlick(metrics)).toBeNull();
  });
});
