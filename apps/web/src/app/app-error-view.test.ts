import { describe, expect, it } from "vitest";
import { errorMessage } from "./app-error-view";

describe.each([
  [new Error("agentd is unavailable"), "agentd is unavailable"],
  ["route failed", "route failed"],
  [{ code: "ECONNREFUSED" }, '{"code":"ECONNREFUSED"}'],
  [null, "Unknown error"],
] as const)("errorMessage", (error, expected) => {
  it(`formats ${expected}`, () => {
    expect(errorMessage(error)).toBe(expected);
  });
});
