import { describe, expect, it } from "vitest";
import { TERMINAL_FONT_FAMILY, TERMINAL_SYMBOL_FONT_FAMILY } from "./terminal-font";

describe("terminal font configuration", () => {
  it("prefers the bundled Nerd Font symbols before local monospace fonts", () => {
    expect(TERMINAL_FONT_FAMILY).toBe(
      '"Symbols Nerd Font Mono", "SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, ui-monospace, monospace',
    );
    expect(TERMINAL_FONT_FAMILY.startsWith(`"${TERMINAL_SYMBOL_FONT_FAMILY}"`)).toBe(true);
  });
});
