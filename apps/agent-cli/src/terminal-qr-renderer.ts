import QRCode from "qrcode";

export interface QrRendererPort {
  render(value: string): Promise<string>;
}

/** Terminal presentation adapter for the QR value supplied by agentd. */
export class TerminalQrRenderer implements QrRendererPort {
  public render(value: string): Promise<string> {
    return QRCode.toString(value, { type: "terminal", small: true });
  }
}
