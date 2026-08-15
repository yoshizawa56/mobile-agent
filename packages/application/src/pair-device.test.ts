import { describe, it } from "vitest";
import {
  hasObserved,
  returns,
  runOperationTable,
  type FixtureHandle,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { PairDevice, type PairingClaim, type PairingControlPort, type PairingOffer, type PairingPresenterPort, type PairDeviceResult } from "./pair-device.js";

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
  public async createPairing(): Promise<PairingOffer> { this.calls.push("create"); return offer; }
  public async waitForClaim(pairingId: string): Promise<PairingClaim> { this.calls.push(`wait:${pairingId}`); return claim; }
  public async approvePairing(pairingId: string) { this.calls.push(`approve:${pairingId}`); return { deviceId: "device-1" }; }
  public async rejectPairing(pairingId: string): Promise<void> { this.calls.push(`reject:${pairingId}`); }
}

class FakePresenter implements PairingPresenterPort {
  public readonly calls: string[] = [];
  public constructor(private readonly answer: boolean) {}
  public async showPairing(received: PairingOffer): Promise<void> { this.calls.push(`show:${received.pairingId}`); }
  public async confirmPairing(received: PairingClaim): Promise<boolean> { this.calls.push(`confirm:${received.pairingId}`); return this.answer; }
}

type PairFixture = { control: FakeControl; presenter: FakePresenter };
type PairInput = { webOrigin: string; agentdBaseUrl: string };
type PairContext = { controlCalls: readonly string[]; presenterCalls: readonly string[] };
type PairKey = "approved" | "rejected";

const createPairFixture = (answer: boolean): (() => FixtureHandle<PairFixture>) => () => ({
  fixture: { control: new FakeControl(), presenter: new FakePresenter(answer) },
});

const pairCases = [
  {
    name: "coordinates offer, claim, approval, and result",
    fixture: "approved",
    input: { webOrigin: offer.webOrigin, agentdBaseUrl: offer.agentdBaseUrl },
    assert: [
      returns<PairContext, PairDeviceResult>({ status: "approved", deviceId: "device-1" }),
      hasObserved<PairContext, PairDeviceResult>("controlCalls", ["create", `wait:${offer.pairingId}`, `approve:${offer.pairingId}`]),
      hasObserved<PairContext, PairDeviceResult>("presenterCalls", [`show:${offer.pairingId}`, `confirm:${offer.pairingId}`]),
    ],
  },
  {
    name: "rejects after a negative presentation decision",
    fixture: "rejected",
    input: { webOrigin: offer.webOrigin, agentdBaseUrl: offer.agentdBaseUrl },
    assert: [
      returns<PairContext, PairDeviceResult>({ status: "rejected" }),
      hasObserved<PairContext, PairDeviceResult>("controlCalls", ["create", `wait:${offer.pairingId}`, `reject:${offer.pairingId}`]),
    ],
  },
] satisfies readonly OperationCase<PairKey, PairInput, PairDeviceResult, PairContext>[];

const pairTable: OperationTable<PairFixture, PairKey, PairInput, PairDeviceResult, PairContext> = {
  defaultFixture: createPairFixture(true),
  fixtures: {
    approved: createPairFixture(true),
    rejected: createPairFixture(false),
  },
  cases: pairCases,
  execute: (fixture, input) => new PairDevice(fixture.control, fixture.presenter).execute(input),
  observe: (fixture) => ({ controlCalls: [...fixture.control.calls], presenterCalls: [...fixture.presenter.calls] }),
};

describe("PairDevice use case", () => {
  runOperationTable(it as unknown as TestRegistrar, pairTable);
});
