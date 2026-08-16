import { describe, expect, it, vi } from "vitest";
import { inlineImageSequence, sanitizeInlineImageName, createImagePaster, type ImagePasteAdapter } from "./image-paste.js";

const bytes = Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff]);

function createFakeTmux() {
  const calls: Array<{ kind: "set"; name: string } | { kind: "paste"; name: string; target: string } | { kind: "delete"; name: string }> = [];
  const adapter: ImagePasteAdapter = {
    setBuffer: vi.fn((name: string, _data: Buffer) => { calls.push({ kind: "set", name }); }),
    pasteBuffer: vi.fn((name: string, target: string) => { calls.push({ kind: "paste", name, target }); }),
    deleteBuffer: vi.fn((name: string) => { calls.push({ kind: "delete", name }); }),
  };
  return { adapter, calls };
}

function createPaster(tmux: ImagePasteAdapter, overrides: Partial<Parameters<typeof createImagePaster>[0]> = {}) {
  const stageImage = overrides.stageImage ?? ((input: { name: string }, dir: string) => `${dir}/${input.name}`);
  return createImagePaster({ tmux, platform: "linux", tempDir: "/tmp", stageImage, ...overrides });
}

describe("image paste adapter", () => {
  it("pastes the image into the pane as an iTerm2 inline-image sequence", () => {
    const { adapter, calls } = createFakeTmux();
    const paster = createPaster(adapter);

    paster({ paneId: "%3", name: "photo.png", mimeType: "image/png", bytes });

    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ kind: "set" });
    expect(calls[1]).toMatchObject({ kind: "paste", target: "%3" });
    expect(calls[2]).toMatchObject({ kind: "delete", name: calls[0].kind === "set" ? calls[0].name : "" });
    const name = calls[0].kind === "set" ? calls[0].name : "";
    expect(name).toMatch(/^agentd-paste-[0-9a-f]{12}$/);
    const sequence = (adapter.setBuffer as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Buffer;
    expect(sequence.toString("utf8")).toBe(`\x1b]1337;file=inline=1;name=photo.png:${bytes.toString("base64")}\x07`);
  });

  it("reports the staged temp file and the pasted byte count", () => {
    const { adapter } = createFakeTmux();
    const paster = createPaster(adapter);

    const result = paster({ paneId: "%3", name: "photo.png", mimeType: "image/png", bytes });

    expect(result).toEqual({
      bytes: bytes.length,
      name: "photo.png",
      tempFilePath: "/tmp/photo.png",
      clipboard: "unavailable",
    });
  });

  it("sets the macOS clipboard when osascript succeeds", () => {
    const { adapter } = createFakeTmux();
    const runOsascript = vi.fn<(script: string) => { status: number | null }>(() => ({ status: 0 }));
    const paster = createPaster(adapter, { platform: "darwin", runOsascript });

    const result = paster({ paneId: "%3", name: "photo.png", bytes });

    expect(result.clipboard).toBe("set");
    expect(runOsascript).toHaveBeenCalledTimes(1);
    const script = runOsascript.mock.calls[0]![0];
    expect(script).toContain("ObjC.import('AppKit')");
    expect(script).toContain("generalPasteboard.writeObjects([image])");
    expect(script).toContain(JSON.stringify(result.tempFilePath));
  });

  it("reports a failed clipboard without failing the paste", () => {
    const { adapter, calls } = createFakeTmux();
    const runOsascript = vi.fn<(script: string) => { status: number | null }>(() => ({ status: 1 }));
    const paster = createPaster(adapter, { platform: "darwin", runOsascript });

    const result = paster({ paneId: "%3", name: "photo.png", bytes });

    expect(result.clipboard).toBe("failed");
    expect(calls).toHaveLength(3);
  });

  it("skips the clipboard off macOS", () => {
    const { adapter } = createFakeTmux();
    const paster = createPaster(adapter);

    const result = paster({ paneId: "%3", name: "photo.png", bytes });

    expect(result.clipboard).toBe("unavailable");
  });

  it("deletes the tmux buffer even when the paste fails", () => {
    const adapter: ImagePasteAdapter = {
      setBuffer: vi.fn(),
      pasteBuffer: vi.fn(() => { throw new Error("tmux paste failed"); }),
      deleteBuffer: vi.fn(),
    };
    const paster = createPaster(adapter);

    expect(() => paster({ paneId: "%3", name: "photo.png", bytes })).toThrow("tmux paste failed");
    expect(adapter.deleteBuffer).toHaveBeenCalledTimes(1);
  });
});

describe("inline image sequence", () => {
  it("encodes the payload as standard base64", () => {
    expect(inlineImageSequence("screenshot.png", bytes)).toBe(`\x1b]1337;file=inline=1;name=screenshot.png:${bytes.toString("base64")}\x07`);
  });

  it("sanitizes names that could break the OSC header", () => {
    expect(sanitizeInlineImageName("a:b;c")).toBe("a_b_c");
    expect(sanitizeInlineImageName("photo\n.png")).toBe("photo_.png");
    expect(sanitizeInlineImageName("  ")).toBe("image");
  });
});
