import { describe, expect, it } from "vitest";
import { hasPaneGeometry, paneLayoutNeedsCompactTargets } from "./pane-layout-overlay-view";

describe("pane layout geometry", () => {
  const geometry = {
    left: 0,
    top: 0,
    width: 80,
    height: 24,
    windowWidth: 160,
    windowHeight: 48,
  } as const;

  it("accepts panes anchored at the tmux origin", () => {
    expect(hasPaneGeometry(geometry)).toBe(true);
  });

  it("requires non-negative positions and positive dimensions", () => {
    expect(hasPaneGeometry({ ...geometry, left: -1 })).toBe(false);
    expect(hasPaneGeometry({ ...geometry, top: -1 })).toBe(false);
    expect(hasPaneGeometry({ ...geometry, width: 0 })).toBe(false);
    expect(hasPaneGeometry({ ...geometry, windowHeight: 0 })).toBe(false);
  });

  it("falls back to a list when a geometric pane would be too small to tap", () => {
    expect(paneLayoutNeedsCompactTargets([
      { ...geometry, width: 8, windowWidth: 160 },
      { ...geometry, top: 24, height: 24, windowHeight: 48 },
    ], 160, 48)).toBe(true);
    expect(paneLayoutNeedsCompactTargets([
      { ...geometry, width: 10, windowWidth: 80 },
      { ...geometry, top: 12, height: 12, windowHeight: 24 },
    ], 80, 24)).toBe(true);
    expect(paneLayoutNeedsCompactTargets([geometry], 160, 48)).toBe(false);
  });

  it("does not apply the compact fallback without a valid window size", () => {
    expect(paneLayoutNeedsCompactTargets([geometry], undefined, 48)).toBe(false);
    expect(paneLayoutNeedsCompactTargets([geometry], 160, 0)).toBe(false);
  });
});
