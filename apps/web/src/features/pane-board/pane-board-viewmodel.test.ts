import { describe, expect, it } from "vitest";
import { paneStateLabel } from "./pane-board-viewmodel";

describe("pane board view model helpers", () => {
  it.each([
    { state: "waiting_input" as const, label: "入力待ち" },
    { state: "waiting_approval" as const, label: "承認待ち" },
    { state: "running" as const, label: "実行中" },
    { state: "failed" as const, label: "失敗" },
  ])("maps $state to a user-facing label", ({ state, label }) => {
    expect(paneStateLabel(state)).toBe(label);
  });
});
