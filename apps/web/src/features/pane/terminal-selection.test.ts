import { describe, expect, it } from "vitest";
import {
  TERMINAL_SELECTION_LONG_PRESS_MS,
  TERMINAL_SELECTION_MOVE_TOLERANCE_PX,
  terminalSelectionLength,
} from "./terminal-selection";

describe("terminal selection gesture helpers", () => {
  it("uses a deliberate long-press threshold with a small movement tolerance", () => {
    expect(TERMINAL_SELECTION_LONG_PRESS_MS).toBeGreaterThan(400);
    expect(TERMINAL_SELECTION_LONG_PRESS_MS).toBeLessThan(600);
    expect(TERMINAL_SELECTION_MOVE_TOLERANCE_PX).toBeGreaterThan(8);
    expect(TERMINAL_SELECTION_MOVE_TOLERANCE_PX).toBeLessThan(20);
  });

  it("includes both endpoint cells when converting a drag into a selection length", () => {
    expect(terminalSelectionLength({ column: 2, row: 4 }, { column: 5, row: 4 }, 80)).toBe(4);
    expect(terminalSelectionLength({ column: 5, row: 4 }, { column: 2, row: 4 }, 80)).toBe(4);
    expect(terminalSelectionLength({ column: 78, row: 4 }, { column: 1, row: 5 }, 80)).toBe(4);
  });
});
