import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyTerminalFlick, installTerminalFlickInput, terminalInputForFlick } from "./terminal-flick";

describe("terminal flick input", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("discards a gesture when the WebView sends pointercancel", () => {
    const container = createPointerSurface();
    const inputs: string[] = [];
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cleanup = installTerminalFlickInput(container, (input) => inputs.push(input));

    dispatchPointer(container, "pointerdown", { pointerId: 1, clientX: 120, clientY: 120 });
    now = 90;
    dispatchPointer(container, "pointermove", { pointerId: 1, clientX: 120, clientY: 48 });
    dispatchPointer(container, "pointercancel", { pointerId: 1, clientX: 120, clientY: 48 });

    expect(inputs).toEqual([]);
    cleanup();
  });

  it("scrolls a deliberate vertical drag instead of sending an arrow key", () => {
    const container = createPointerSurface();
    const inputs: string[] = [];
    const scrollDeltas: number[] = [];
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cleanup = installTerminalFlickInput(container, (input) => inputs.push(input), {
      onScroll: (deltaY) => scrollDeltas.push(deltaY),
    });

    dispatchPointer(container, "pointerdown", { pointerId: 1, clientX: 120, clientY: 120 });
    now = 300;
    dispatchPointer(container, "pointermove", { pointerId: 1, clientX: 120, clientY: 150 });
    now = 420;
    dispatchPointer(container, "pointermove", { pointerId: 1, clientX: 120, clientY: 174 });
    now = 500;
    dispatchPointer(container, "pointerup", { pointerId: 1, clientX: 120, clientY: 174 });

    expect(scrollDeltas).toEqual([30, 24]);
    expect(inputs).toEqual([]);
    cleanup();
  });

  it("discards a gesture when a second touch joins it", () => {
    const container = createPointerSurface();
    const inputs: string[] = [];
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cleanup = installTerminalFlickInput(container, (input) => inputs.push(input));

    dispatchPointer(container, "pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(container, "pointerdown", { pointerId: 2, clientX: 20, clientY: 20 });
    now = 100;
    dispatchPointer(container, "pointerup", { pointerId: 1, clientX: 90, clientY: 10 });
    dispatchPointer(container, "pointerup", { pointerId: 2, clientX: 20, clientY: 20 });

    expect(inputs).toEqual([]);
    cleanup();
  });
});

function createPointerSurface(): HTMLElement {
  const surface = new EventTarget() as EventTarget & Partial<HTMLElement>;
  surface.setPointerCapture = vi.fn();
  return surface as HTMLElement;
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
