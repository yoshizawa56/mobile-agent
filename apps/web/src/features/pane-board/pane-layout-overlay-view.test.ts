import { describe, expect, it } from "vitest";
import { hasPaneGeometry } from "./pane-layout-overlay-view";

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
});
