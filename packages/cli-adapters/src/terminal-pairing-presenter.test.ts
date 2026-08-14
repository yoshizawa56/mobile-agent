import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { PairingOffer } from "@mobile-agent/application";
import { TerminalPairingPresenter } from "./terminal-pairing-presenter.js";

class CaptureOutput extends Writable {
  public value = "";

  public _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error) => void): void {
    this.value += chunk.toString();
    callback();
  }
}

const offer: PairingOffer = {
  pairingId: "pairing-1234567890123456",
  pairingUrl: "https://web.example/settings#ma1=secret",
  webOrigin: "https://web.example",
  agentdBaseUrl: "https://agentd.example",
  expiresAt: Date.now() + 300_000,
};

describe("TerminalPairingPresenter", () => {
  it("hands the opaque pairing URL to the terminal QR adapter", async () => {
    const out = new CaptureOutput();
    let received: string | undefined;
    const presenter = new TerminalPairingPresenter({
      out,
      input: process.stdin,
      qrRenderer: {
        render: async (value) => {
          received = value;
          return "rendered-qr";
        },
      },
    });

    await presenter.showPairing(offer);

    expect(received).toBe(offer.pairingUrl);
    expect(out.value).toContain("rendered-qr");
    expect(out.value).toContain("Web画面でこのQRを読み取ってください");
  });
});
