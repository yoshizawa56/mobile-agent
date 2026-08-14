import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  TERMINAL_SELECTION_LONG_PRESS_MS,
  TERMINAL_SELECTION_MOVE_TOLERANCE_PX,
  installTerminalSelectionGesture,
  terminalSelectionLength,
} from "./terminal-selection";

describe("terminal selection gesture helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it("keeps a long-press selection alive through a touch move", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const container = createTerminalSurface();
    const terminal = createTerminal();
    const modeChanges: boolean[] = [];
    const cleanup = installTerminalSelectionGesture(container, terminal, {
      isSelectionMode: () => modeChanges.at(-1) === true,
      onSelectionModeChange: (active) => modeChanges.push(active),
    });

    dispatchPointer(container, "pointerdown", { pointerId: 1, clientX: 10, clientY: 5 });
    vi.advanceTimersByTime(TERMINAL_SELECTION_LONG_PRESS_MS);
    expect(terminal.select).toHaveBeenCalledTimes(1);
    expect(modeChanges).toEqual([true]);

    const move = dispatchTouch(container, "touchmove", { clientX: 42, clientY: 10 });
    expect(move.defaultPrevented).toBe(true);
    expect(terminal.select).toHaveBeenCalledTimes(2);

    dispatchPointer(container, "pointerup", { pointerId: 1, clientX: 42, clientY: 10 });
    expect(modeChanges).toEqual([true]);
    cleanup();
  });

  it("cancels the long press when the finger moves before the threshold", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const container = createTerminalSurface();
    const terminal = createTerminal();
    const cleanup = installTerminalSelectionGesture(container, terminal, {
      isSelectionMode: () => false,
      onSelectionModeChange: vi.fn(),
    });

    dispatchPointer(container, "pointerdown", { pointerId: 1, clientX: 10, clientY: 5 });
    dispatchPointer(container, "pointermove", { pointerId: 1, clientX: 30, clientY: 5 });
    vi.advanceTimersByTime(TERMINAL_SELECTION_LONG_PRESS_MS);

    expect(terminal.select).not.toHaveBeenCalled();
    cleanup();
  });
});

function createTerminalSurface(): HTMLElement {
  const surface = new EventTarget() as EventTarget & Partial<HTMLElement>;
  surface.setPointerCapture = vi.fn();
  surface.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 80,
    height: 24,
    right: 80,
    bottom: 24,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  });
  return surface as HTMLElement;
}

function createTerminal(): Terminal {
  return {
    cols: 80,
    rows: 24,
    element: null,
    buffer: { active: { viewportY: 0, length: 24 } },
    focus: vi.fn(),
    select: vi.fn(),
  } as unknown as Terminal;
}

function dispatchPointer(
  surface: HTMLElement,
  type: string,
  values: { pointerId: number; clientX: number; clientY: number },
): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    pointerType: { value: "touch" },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
  });
  surface.dispatchEvent(event);
}

function dispatchTouch(surface: HTMLElement, type: string, values: { clientX: number; clientY: number }): Event {
  const event = new Event(type, { cancelable: true });
  const touch = { clientX: values.clientX, clientY: values.clientY };
  Object.defineProperties(event, {
    touches: { value: [touch] },
    changedTouches: { value: [touch] },
  });
  surface.dispatchEvent(event);
  return event;
}
