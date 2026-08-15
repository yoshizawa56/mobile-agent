import { describe, it } from "vitest";
import {
  hasError,
  noFixture,
  returns,
  runOperationTable,
  type OperationCase,
  type OperationTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { encodePairingCode } from "@mobile-agent/protocol";
import { parsePairingQrPayload } from "./browser-auth";
import type { PairingQrPayload } from "@mobile-agent/protocol";

type EmptyContext = {};
type PairingPayloadInput = { code: string };

const payload: PairingQrPayload = {
  v: 2,
  agentdBaseUrl: "https://agent-host.tailnet.ts.net:8444/",
  serverId: "server-1234567890123456",
  pairingId: "pairing-1234567890123456",
  pairingSecret: "abcdefghijklmnopqrstuvwxyz0123456789_-",
  expiresAt: 4_102_444_800_000,
};

const cases = [
  {
    name: "parses the raw pairing code without a browser origin",
    input: { code: encodePairingCode(payload) },
    assert: [returns<EmptyContext, PairingQrPayload>(payload)],
  },
  {
    name: "rejects a navigation URL instead of decoding it",
    input: { code: "https://agent-host.example/settings#ma1=payload" },
    assert: [hasError<EmptyContext, PairingQrPayload>({ message: "QR code does not contain a valid mobile-agent pairing code" })],
  },
  {
    name: "rejects an expired pairing code",
    input: { code: encodePairingCode({ ...payload, expiresAt: 1 }) },
    assert: [hasError<EmptyContext, PairingQrPayload>({ message: "This pairing QR code has expired" })],
  },
  {
    name: "rejects an endpoint with an unsupported protocol",
    input: { code: encodePairingCode({ ...payload, agentdBaseUrl: "ftp://agent-host.example" }) },
    assert: [hasError<EmptyContext, PairingQrPayload>({ message: "Pairing endpoint must use http or https" })],
  },
] satisfies readonly OperationCase<"default", PairingPayloadInput, PairingQrPayload, EmptyContext>[];

const table: OperationTable<undefined, "default", PairingPayloadInput, PairingQrPayload, EmptyContext> = {
  defaultFixture: noFixture(),
  cases,
  execute: (_fixture, input) => parsePairingQrPayload(input.code),
  observe: () => ({}),
};

describe("browser pairing code parsing", () => {
  runOperationTable(it as unknown as TestRegistrar, table);
});
