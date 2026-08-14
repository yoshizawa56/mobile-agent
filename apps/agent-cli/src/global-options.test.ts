import { describe, expect, it } from "vitest";
import { parseGlobalOptions } from "./global-options.js";

describe("agent global options", () => {
  it("consumes leading verbose flags before the command", () => {
    expect(parseGlobalOptions(["-v", "--verbose", "run", "claude"])).toEqual({
      args: ["run", "claude"],
      verbose: true,
    });
  });

  it("leaves command arguments untouched after the command starts", () => {
    expect(parseGlobalOptions(["run", "claude", "-v"])).toEqual({
      args: ["run", "claude", "-v"],
      verbose: false,
    });
  });
});
