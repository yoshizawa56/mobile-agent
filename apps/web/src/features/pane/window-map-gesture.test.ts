import { describe, expect, it } from "vitest";
import { classifyPinchDirection, isBrowserZoomKey, isZoomInKey } from "./window-map-gesture";

describe("window map pinch shortcut", () => {
  it.each([
    { initial: 120, current: 150, direction: "out" as const },
    { initial: 150, current: 120, direction: "in" as const },
  ])("classifies a deliberate pinch $direction", ({ initial, current, direction }) => {
    expect(classifyPinchDirection(initial, current)).toBe(direction);
  });

  it("ignores movement below the deliberate-gesture threshold", () => {
    expect(classifyPinchDirection(120, 141)).toBeNull();
  });
});

describe("browser zoom shortcut keys", () => {
  it.each([
    { key: "+", ctrlKey: true, metaKey: false, zoomIn: true },
    { key: "=", ctrlKey: false, metaKey: true, zoomIn: true },
    { key: "-", ctrlKey: true, metaKey: false, zoomIn: false },
    { key: "0", ctrlKey: false, metaKey: true, zoomIn: false },
  ])("recognizes $key with a platform modifier", ({ key, ctrlKey, metaKey, zoomIn }) => {
    const event = { key, ctrlKey, metaKey };
    expect(isBrowserZoomKey(event)).toBe(true);
    expect(isZoomInKey(event)).toBe(zoomIn);
  });

  it("does not treat an unmodified key as browser zoom", () => {
    expect(isBrowserZoomKey({ key: "+", ctrlKey: false, metaKey: false })).toBe(false);
  });
});
