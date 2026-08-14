import { Writable, Readable } from "node:stream";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PairDevice } from "@mobile-agent/application";
import { PairCommand, parsePairCommandOptions, type PairDeviceRuntime } from "./pair-command.js";

class CaptureOutput extends Writable {
  public value = "";

  public _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error) => void): void {
    this.value += chunk.toString();
    callback();
  }
}

describe("agent pair CLI adapter", () => {
  it("derives the control socket from the instance directory", () => {
    expect(parsePairCommandOptions([], { AGENTD_INSTANCE_DIR: "/tmp/mobile-agent/main" }).controlSocket)
      .toBe("/tmp/mobile-agent/main/agentd.sock");
  });

  it("normalizes a relative control socket override", () => {
    expect(parsePairCommandOptions(["--control-socket", "run/agentd.sock"], {}).controlSocket)
      .toBe(resolve("run/agentd.sock"));
  });

  it("maps command options into the injected use case and result code", async () => {
    const out = new CaptureOutput();
    let closed = false;
    let received: unknown;
    const runtime: PairDeviceRuntime = {
      useCase: {
        execute: async (input) => {
          received = input;
          return { status: "approved", deviceId: "device-1" };
        },
      } as PairDevice,
      close: () => { closed = true; },
    };
    const command = new PairCommand({
      env: { AGENTD_CONTROL_SOCKET: "/tmp/agentd.control.sock" },
      io: { out, input: Readable.from([]) },
      createRuntime: async (options) => {
        expect(options.controlSocket).toBe("/tmp/agentd.control.sock");
        return runtime;
      },
    });

    await expect(command.execute(["--web-origin", "https://web.example", "--agentd-base-url", "https://agentd.example"])).resolves.toBe(0);
    expect(received).toEqual({ webOrigin: "https://web.example", agentdBaseUrl: "https://agentd.example" });
    expect(out.value).toContain("承認しました。deviceId: device-1");
    expect(closed).toBe(true);
  });

  it("does not construct runtime dependencies for help", async () => {
    const out = new CaptureOutput();
    let constructed = false;
    const command = new PairCommand({
      io: { out, input: Readable.from([]) },
      createRuntime: async () => {
        constructed = true;
        throw new Error("must not be called");
      },
    });

    await expect(command.execute(["--help"])).resolves.toBe(0);
    expect(constructed).toBe(false);
    expect(out.value).toContain("Usage: agent pair");
  });
});
