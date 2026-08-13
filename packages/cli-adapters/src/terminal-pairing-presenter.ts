import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { PairingClaim, PairingOffer, PairingPresenterPort } from "@mobile-agent/application";
import { TerminalQrRenderer, type QrRendererPort } from "./terminal-qr-renderer.js";

export type TerminalPairingPresenterOptions = {
  out: Writable;
  input: Readable;
  qrRenderer?: QrRendererPort;
};

/** Terminal UI adapter for the pairing use case. */
export class TerminalPairingPresenter implements PairingPresenterPort {
  private readonly qrRenderer: QrRendererPort;

  public constructor(private readonly options: TerminalPairingPresenterOptions) {
    this.qrRenderer = options.qrRenderer ?? new TerminalQrRenderer();
  }

  public async showPairing(offer: PairingOffer): Promise<void> {
    const qr = await this.qrRenderer.render(offer.pairingUrl);
    this.write("agent pair\n");
    this.write(`Web: ${offer.webOrigin}\nagentd: ${offer.agentdBaseUrl}\n有効期限: ${new Date(offer.expiresAt).toLocaleString()}\n\n`);
    this.write(qr);
    if (!qr.endsWith("\n")) this.write("\n");
    this.write("Web画面でこのQRを読み取ってください。接続要求が届くまで待機します。\n");
  }

  public async confirmPairing(claim: PairingClaim): Promise<boolean> {
    this.write(`\n端末から接続要求が届きました。\n  名前: ${claim.deviceName}\n  種別: ${claim.deviceType}\n  platform: ${claim.platform ?? "(未申告)"}\n  clientVersion: ${claim.clientVersion ?? "(未申告)"}\n  公開鍵 fingerprint: ${claim.keyFingerprint}\n`);
    const prompt = createInterface({ input: this.options.input, output: this.options.out });
    try {
      const answer = await prompt.question("この端末を承認しますか？ [y/N] ");
      return /^(y|yes)$/i.test(answer.trim());
    } finally {
      prompt.close();
    }
  }

  private write(value: string): void {
    this.options.out.write(value);
  }
}
