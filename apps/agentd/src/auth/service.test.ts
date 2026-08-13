import { describe, expect, it } from "vitest";
import { createAgentDatabase, AuthStore } from "@mobile-agent/persistence";
import {
  pairingClaimMessage,
  publicKeyFingerprint,
  sessionMessage,
  sha256Hex,
  signEcdsa,
} from "@mobile-agent/protocol";
import { AuthService } from "./service.js";

describe("agentd device authentication", () => {
  it("requires a signed claim, host approval, and signed session challenge", async () => {
    const database = createAgentDatabase();
    try {
      const auth = new AuthService({
        store: new AuthStore(database.sqlite),
        webOrigin: "http://localhost:5173",
        agentdBaseUrl: "http://127.0.0.1:4317",
      });
      const payload = auth.createPairing();
      const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      const publicKey = { kty: "EC" as const, crv: "P-256" as const, x: exported.x!, y: exported.y! };
      const keyFingerprint = await publicKeyFingerprint(publicKey);
      const clientNonce = "client-nonce-123456";
      const pairingSecretHash = await sha256Hex(payload.pairingSecret);
      const claimSignature = await signEcdsa(keyPair.privateKey, pairingClaimMessage({
        serverId: payload.serverId,
        pairingId: payload.pairingId,
        pairingSecretHash,
        keyFingerprint,
        clientNonce,
      }));

      const claim = auth.claimPairing(payload.pairingId, {
        pairingSecret: payload.pairingSecret,
        publicKey,
        deviceName: "Test browser",
        deviceType: "browser",
        platform: "test",
        clientVersion: "test",
        clientNonce,
        signature: claimSignature,
      });
      expect(claim.status).toBe("awaiting_approval");
      expect(auth.pairingStatus(payload.pairingId, claim.claimToken).status).toBe("awaiting_approval");

      const device = auth.approvePairing(payload.pairingId);
      expect(device.keyFingerprint).toBe(keyFingerprint);
      expect(auth.pairingStatus(payload.pairingId, claim.claimToken)).toMatchObject({ status: "approved", deviceId: device.deviceId });

      const challenge = auth.createChallenge(device.deviceId);
      const signature = await signEcdsa(keyPair.privateKey, sessionMessage({
        serverId: challenge.serverId,
        deviceId: challenge.deviceId,
        challengeId: challenge.challengeId,
        challengeNonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      }));
      const session = auth.createSession({ deviceId: device.deviceId, challengeId: challenge.challengeId, signature });
      const context = auth.authenticateAccessToken(session.accessToken);
      expect(context?.deviceId).toBe(device.deviceId);

      const ticket = auth.issueWebSocketTicket(context!, "events");
      expect(auth.consumeWebSocketTicket(ticket.ticket, "events")?.sessionId).toBe(session.sessionId);
      expect(auth.consumeWebSocketTicket(ticket.ticket, "events")).toBeNull();
    } finally {
      database.close();
    }
  });
});
