import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  hasObserved,
  noFixture,
  returns,
  runOperationTable,
  runScenarioTable,
  type Assertion,
  type FixtureHandle,
  type OperationCase,
  type OperationTable,
  type ScenarioCase,
  type ScenarioTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import {
  TERMINAL_SELECTION_LONG_PRESS_MS,
  TERMINAL_SELECTION_MOVE_TOLERANCE_PX,
  installTerminalSelectionGesture,
  terminalSelectionLength,
} from "./terminal-selection";

type EmptyContext = {};

type LengthInput = {
  start: { column: number; row: number };
  end: { column: number; row: number };
  columns: number;
};

const lengthCases = [
  { name: "includes both endpoints in a forward drag", input: { start: { column: 2, row: 4 }, end: { column: 5, row: 4 }, columns: 80 }, assert: [returns<EmptyContext, number>(4)] },
  { name: "includes both endpoints in a reverse drag", input: { start: { column: 5, row: 4 }, end: { column: 2, row: 4 }, columns: 80 }, assert: [returns<EmptyContext, number>(4)] },
  { name: "handles a drag across a row boundary", input: { start: { column: 78, row: 4 }, end: { column: 1, row: 5 }, columns: 80 }, assert: [returns<EmptyContext, number>(4)] },
] satisfies readonly OperationCase<"default", LengthInput, number, EmptyContext>[];

const lengthTable: OperationTable<undefined, "default", LengthInput, number, EmptyContext> = {
  defaultFixture: noFixture(),
  cases: lengthCases,
  execute: (_fixture, input) => terminalSelectionLength(input.start, input.end, input.columns),
  observe: () => ({}),
};

type ThresholdInput = { value: number; lower: number; upper: number };
const thresholdCases = [
  { name: "uses a long-press threshold", input: { value: TERMINAL_SELECTION_LONG_PRESS_MS, lower: 400, upper: 600 }, assert: [returns<EmptyContext, boolean>(true)] },
  { name: "uses a small movement tolerance", input: { value: TERMINAL_SELECTION_MOVE_TOLERANCE_PX, lower: 8, upper: 20 }, assert: [returns<EmptyContext, boolean>(true)] },
] satisfies readonly OperationCase<"default", ThresholdInput, boolean, EmptyContext>[];

const thresholdTable: OperationTable<undefined, "default", ThresholdInput, boolean, EmptyContext> = {
  defaultFixture: noFixture(),
  cases: thresholdCases,
  execute: (_fixture, input) => input.value > input.lower && input.value < input.upper,
  observe: () => ({}),
};

type PointerValues = { pointerId: number; clientX: number; clientY: number };
type SelectionStep =
  | { type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel"; values: PointerValues }
  | { type: "touchmove"; clientX: number; clientY: number }
  | { type: "advance"; milliseconds: number };
type SelectionContext = {
  selections: readonly (readonly [number, number, number])[];
  modeChanges: readonly boolean[];
  preventedTouchMoves: number;
};
type SelectionResult = { preventedTouchMoves: number };
type SelectionFixture = {
  container: HTMLElement;
  terminal: Terminal;
  selections: Array<[number, number, number]>;
  modeChanges: boolean[];
};

const keepsSelectionAlive: Assertion<SelectionContext, SelectionResult> = {
  name: "updates the selection from the touch move",
  check: (ctx) => {
    expect(ctx.selections).toHaveLength(2);
    expect(ctx.selections[0]).toEqual([10, 5, 1]);
    expect(ctx.selections[1]?.slice(0, 2)).toEqual([10, 5]);
    expect(ctx.selections[1]?.[2]).toBeGreaterThan(1);
  },
};

const selectionFixture = (): FixtureHandle<SelectionFixture> => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  const container = createTerminalSurface();
  const selections: Array<[number, number, number]> = [];
  const modeChanges: boolean[] = [];
  const terminal = createTerminal(selections);
  const cleanupGesture = installTerminalSelectionGesture(container, terminal, {
    isSelectionMode: () => modeChanges.at(-1) === true,
    onSelectionModeChange: (active) => modeChanges.push(active),
  });
  return {
    fixture: { container, terminal, selections, modeChanges },
    cleanup: () => {
      cleanupGesture();
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
};

const gestureCases = [
  {
    name: "keeps a long-press selection alive through touch move",
    steps: [
      { type: "pointerdown", values: { pointerId: 1, clientX: 10, clientY: 5 } },
      { type: "advance", milliseconds: TERMINAL_SELECTION_LONG_PRESS_MS },
      { type: "touchmove", clientX: 42, clientY: 10 },
      { type: "pointerup", values: { pointerId: 1, clientX: 42, clientY: 10 } },
    ],
    assert: [
      keepsSelectionAlive,
      hasObserved<SelectionContext, SelectionResult>("modeChanges", [true]),
      hasObserved<SelectionContext, SelectionResult>("preventedTouchMoves", 1),
    ],
  },
  {
    name: "cancels the long press when the finger moves early",
    steps: [
      { type: "pointerdown", values: { pointerId: 1, clientX: 10, clientY: 5 } },
      { type: "pointermove", values: { pointerId: 1, clientX: 30, clientY: 5 } },
      { type: "advance", milliseconds: TERMINAL_SELECTION_LONG_PRESS_MS },
    ],
    assert: [hasObserved<SelectionContext, SelectionResult>("selections", [])],
  },
] satisfies readonly ScenarioCase<"default", SelectionStep, SelectionResult, SelectionContext>[];

const gestureTable: ScenarioTable<SelectionFixture, "default", SelectionStep, SelectionResult, SelectionContext> = {
  defaultFixture: selectionFixture,
  cases: gestureCases,
  execute: (fixture, steps) => {
    let preventedTouchMoves = 0;
    for (const step of steps) {
      if (step.type === "advance") {
        vi.advanceTimersByTime(step.milliseconds);
        continue;
      }
      if (step.type === "touchmove") {
        const event = dispatchTouch(fixture.container, step.type, step);
        if (event.defaultPrevented) preventedTouchMoves += 1;
        continue;
      }
      dispatchPointer(fixture.container, step.type, step.values);
    }
    return { preventedTouchMoves };
  },
  observe: (fixture, result) => ({
    selections: fixture.selections.map((selection) => [...selection] as [number, number, number]),
    modeChanges: [...fixture.modeChanges],
    preventedTouchMoves: result.ok ? result.value.preventedTouchMoves : 0,
  }),
};

describe("terminal selection gesture helpers", () => {
  const register = it as unknown as TestRegistrar;
  runOperationTable(register, lengthTable);
  runOperationTable(register, thresholdTable);
  runScenarioTable(register, gestureTable);
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

function createTerminal(selections: Array<[number, number, number]>): Terminal {
  return {
    cols: 80,
    rows: 24,
    element: null,
    buffer: { active: { viewportY: 0, length: 24 } },
    focus: vi.fn(),
    select: vi.fn((column: number, row: number, length: number) => selections.push([column, row, length])),
  } as unknown as Terminal;
}

function dispatchPointer(surface: HTMLElement, type: string, values: PointerValues): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    pointerType: { value: "touch" },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
  });
  surface.dispatchEvent(event);
}

function dispatchTouch(surface: HTMLElement, _type: "touchmove", values: { clientX: number; clientY: number }): Event {
  const event = new Event("touchmove", { cancelable: true });
  const touch = { clientX: values.clientX, clientY: values.clientY };
  Object.defineProperties(event, {
    touches: { value: [touch] },
    changedTouches: { value: [touch] },
  });
  surface.dispatchEvent(event);
  return event;
}
