import { describe, expect, it } from "vitest";
import { PairDevice, type PairingClaim, type PairingControlPort, type PairingOffer, type PairingPresenterPort } from "./pair-device.js";

const offer: PairingOffer = {
  pairingId: "pairing-1234567890123456",
  pairingUrl: "https://web.example/settings#ma1=secret",
  webOrigin: "https://web.example",
  agentdBaseUrl: "https://agentd.example",
  expiresAt: Date.now() + 300_000,
};

const claim: PairingClaim = {
  pairingId: offer.pairingId,
  serverId: "server-1234567890123456",
  deviceName: "Test browser",
  deviceType: "browser",
  platform: "test",
  clientVersion: "test",
  keyFingerprint: "fingerprint",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

class FakeControl implements PairingControlPort {
  public readonly calls: string[] = [];

  public async createPairing(): Promise<PairingOffer> {
    this.calls.push("create");
    return offer;
  }

  public async waitForClaim(pairingId: string): Promise<PairingClaim> {
    this.calls.push(`wait:${pairingId}`);
    return claim;
  }

  public async approvePairing(pairingId: string) {
    this.calls.push(`approve:${pairingId}`);
    return { deviceId: "device-1" };
  }

  public async rejectPairing(pairingId: string): Promise<void> {
    this.calls.push(`reject:${pairingId}`);
  }
}

class FakePresenter implements PairingPresenterPort {
  public readonly calls: string[] = [];

  public constructor(private readonly answer: boolean) {}

  public async showPairing(received: PairingOffer): Promise<void> {
    this.calls.push(`show:${received.pairingId}`);
  }

  public async confirmPairing(received: PairingClaim): Promise<boolean> {
    this.calls.push(`confirm:${received.pairingId}`);
    return this.answer;
  }
}

describe("PairDevice use case", () => {
  it("coordinates the offer, claim, approval, and result", async () => {
    const control = new FakeControl();
    const presenter = new FakePresenter(true);

    await expect(new PairDevice(control, presenter).execute({
      webOrigin: offer.webOrigin,
      agentdBaseUrl: offer.agentdBaseUrl,
    })).resolves.toEqual({ status: "approved", deviceId: "device-1" });

    expect(control.calls).toEqual(["create", `wait:${offer.pairingId}`, `approve:${offer.pairingId}`]);
    expect(presenter.calls).toEqual([`show:${offer.pairingId}`, `confirm:${offer.pairingId}`]);
  });

  it("rejects after an explicit negative presentation decision", async () => {
    const control = new FakeControl();
    const presenter = new FakePresenter(false);

    await expect(new PairDevice(control, presenter).execute({
      webOrigin: offer.webOrigin,
      agentdBaseUrl: offer.agentdBaseUrl,
    })).resolves.toEqual({ status: "rejected" });

    expect(control.calls).toEqual(["create", `wait:${offer.pairingId}`, `reject:${offer.pairingId}`]);
  });
});
