import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import type { WebSocket } from "ws";
import {
  canonicalPublicJwk,
  decodeBase64Url,
  pairingClaimMessage,
  sessionMessage,
  type AuthChallengeResponse,
  type AuthDeviceType,
  type AuthSessionResponse,
  type PairingClaimRequest,
  type PairingClaimResponse,
  type PairingQrPayload,
  type PairingStatus,
  type PublicKeyJwk,
  type WsTicketResponse,
} from "@mobile-agent/protocol";
import {
  AuthStore,
  AuthStoreError,
  type AuthDeviceRecord,
  type AuthSessionRecord,
} from "@mobile-agent/persistence";

const PAIRING_TTL_MS = 5 * 60_000;
const CLAIM_TTL_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 15 * 60_000;
const WS_TICKET_TTL_MS = 30_000;

export type AuthServiceOptions = {
  store: AuthStore;
  webOrigin: string;
  agentdBaseUrl: string;
};

export type PairingClaimNotification = {
  pairingId: string;
  serverId: string;
  deviceName: string;
  deviceType: AuthDeviceType;
  platform: string | null;
  clientVersion: string | null;
  keyFingerprint: string;
  expiresAt: string;
};

export type AuthContext = AuthSessionRecord & {
  device: AuthDeviceRecord;
};

type PendingChallenge = {
  challengeId: string;
  deviceId: string;
  nonce: string;
  expiresAt: string;
};

type PendingWsTicket = {
  sessionId: string;
  endpoint: "terminal" | "events";
  expiresAt: string;
};

type TrackedSockets = {
  deviceId: string;
  sockets: Set<WebSocket>;
  expiryTimers: Map<WebSocket, NodeJS.Timeout>;
};

export class AuthService {
  public readonly serverId: string;
  private readonly allowedWebOrigins = new Set<string>();
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly challengeWindows = new Map<string, { startedAt: number; count: number }>();
  private readonly wsTickets = new Map<string, PendingWsTicket>();
  private readonly sockets = new Map<string, TrackedSockets>();
  private pairingClaimListener: ((notification: PairingClaimNotification) => void) | undefined;

  public constructor(private readonly options: AuthServiceOptions) {
    this.serverId = options.store.getServerId();
    this.allowedWebOrigins.add(normalizeOrigin(options.webOrigin));
  }

  public setPairingClaimListener(listener: ((notification: PairingClaimNotification) => void) | undefined): void {
    this.pairingClaimListener = listener;
  }

  public allowsWebOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    try {
      return this.allowedWebOrigins.has(new URL(origin).origin);
    } catch {
      return false;
    }
  }

  public createPairing(overrides: Partial<Pick<AuthServiceOptions, "webOrigin" | "agentdBaseUrl">> = {}): PairingQrPayload {
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    const webOrigin = overrides.webOrigin ?? this.options.webOrigin;
    const pairing = this.options.store.createPairing({
      webOrigin,
      agentdBaseUrl: overrides.agentdBaseUrl ?? this.options.agentdBaseUrl,
      expiresAt: expiresAt.toISOString(),
      secret: randomOpaque(32),
    });
    this.allowedWebOrigins.add(normalizeOrigin(webOrigin));
    return {
      v: 1,
      webOrigin: pairing.webOrigin,
      agentdBaseUrl: pairing.agentdBaseUrl,
      serverId: pairing.serverId,
      pairingId: pairing.pairingId,
      pairingSecret: pairing.secret,
      expiresAt: expiresAt.getTime(),
    };
  }

  public claimPairing(pairingId: string, request: PairingClaimRequest): PairingClaimResponse {
    const publicKey = request.publicKey;
    const keyFingerprint = fingerprint(publicKey);
    const secretHash = hashOpaque(request.pairingSecret);
    const message = pairingClaimMessage({
      serverId: this.serverId,
      pairingId,
      pairingSecretHash: secretHash,
      keyFingerprint,
      clientNonce: request.clientNonce,
    });
    if (!verifyPublicKeySignature(publicKey, message, request.signature)) {
      throw new AuthStoreError("claim_signature_invalid", "pairing claim signature is invalid");
    }

    const claimToken = randomOpaque(32);
    const claimExpiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
    const result = this.options.store.claimPairing({
      pairingId,
      secretHash,
      claimToken,
      claimExpiresAt,
      publicKeyJwk: JSON.stringify(publicKey),
      keyFingerprint,
      displayName: request.deviceName,
      deviceType: request.deviceType,
      platform: request.platform ?? null,
      clientVersion: request.clientVersion ?? null,
    });
    this.pairingClaimListener?.({
      pairingId,
      serverId: this.serverId,
      deviceName: request.deviceName,
      deviceType: request.deviceType,
      platform: request.platform ?? null,
      clientVersion: request.clientVersion ?? null,
      keyFingerprint,
      expiresAt: claimExpiresAt,
    });
    return {
      serverId: this.serverId,
      pairingId,
      claimToken,
      status: "awaiting_approval",
      expiresAt: claimExpiresAt,
      keyFingerprint,
    };
  }

  public pairingStatus(pairingId: string, claimToken: string): PairingStatus {
    return this.options.store.getPairingStatus(pairingId, claimToken);
  }

  public approvePairing(pairingId: string): AuthDeviceRecord {
    return this.options.store.approvePairing(pairingId);
  }

  public rejectPairing(pairingId: string): void {
    this.options.store.rejectPairing(pairingId);
  }

  public createChallenge(deviceId: string): AuthChallengeResponse {
    const device = this.requireActiveDevice(deviceId);
    const now = Date.now();
    const window = this.challengeWindows.get(deviceId);
    if (!window || now - window.startedAt >= 60_000) {
      this.challengeWindows.set(deviceId, { startedAt: now, count: 1 });
    } else {
      if (window.count >= 10) throw new AuthStoreError("challenge_rate_limited", "too many authentication challenges requested");
      window.count += 1;
    }
    if (this.challenges.size > 1_000) {
      for (const [challengeId, challenge] of this.challenges) {
        if (isExpired(challenge.expiresAt)) this.challenges.delete(challengeId);
      }
    }
    const challengeId = randomOpaque(24);
    const nonce = randomOpaque(32);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    this.challenges.set(challengeId, { challengeId, deviceId, nonce, expiresAt });
    return { serverId: this.serverId, deviceId: device.deviceId, challengeId, nonce, expiresAt };
  }

  public createSession(input: { deviceId: string; challengeId: string; signature: string }): AuthSessionResponse {
    const challenge = this.challenges.get(input.challengeId);
    this.challenges.delete(input.challengeId);
    if (!challenge || challenge.deviceId !== input.deviceId || isExpired(challenge.expiresAt)) {
      throw new AuthStoreError("challenge_invalid", "authentication challenge is invalid or expired");
    }
    const device = this.requireActiveDevice(input.deviceId);
    const message = sessionMessage({
      serverId: this.serverId,
      deviceId: input.deviceId,
      challengeId: challenge.challengeId,
      challengeNonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
    });
    if (!verifyPublicKeySignature(parsePublicKey(device.publicKeyJwk), message, input.signature)) {
      throw new AuthStoreError("session_signature_invalid", "session signature is invalid");
    }

    const sessionId = randomOpaque(24);
    const accessToken = randomOpaque(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.options.store.createSession({ sessionId, token: accessToken, deviceId: device.deviceId, expiresAt });
    return { serverId: this.serverId, deviceId: device.deviceId, sessionId, accessToken, expiresAt };
  }

  public authenticateAccessToken(token: string | undefined): AuthContext | null {
    if (!token) return null;
    const session = this.options.store.findSession(token);
    return session ? this.contextForSession(session) : null;
  }

  public issueWebSocketTicket(context: AuthContext, endpoint: "terminal" | "events"): WsTicketResponse {
    const ticket = randomOpaque(32);
    const expiresAt = new Date(Date.now() + WS_TICKET_TTL_MS).toISOString();
    this.wsTickets.set(hashOpaque(ticket), { sessionId: context.sessionId, endpoint, expiresAt });
    return { ticket, endpoint, expiresAt };
  }

  public consumeWebSocketTicket(ticket: string | undefined, endpoint: "terminal" | "events"): AuthContext | null {
    if (!ticket) return null;
    const ticketHash = hashOpaque(ticket);
    const pending = this.wsTickets.get(ticketHash);
    this.wsTickets.delete(ticketHash);
    if (!pending || pending.endpoint !== endpoint || isExpired(pending.expiresAt)) return null;
    const session = this.options.store.findSessionById(pending.sessionId);
    return session ? this.contextForSession(session) : null;
  }

  public trackSocket(context: AuthContext, socket: WebSocket): void {
    const tracked = this.sockets.get(context.sessionId) ?? {
      deviceId: context.deviceId,
      sockets: new Set<WebSocket>(),
      expiryTimers: new Map<WebSocket, NodeJS.Timeout>(),
    };
    tracked.sockets.add(socket);
    const remainingMs = Math.max(0, new Date(context.expiresAt).getTime() - Date.now());
    const expiryTimer = setTimeout(() => socket.close(4001, "session expired"), remainingMs);
    expiryTimer.unref?.();
    tracked.expiryTimers.set(socket, expiryTimer);
    this.sockets.set(context.sessionId, tracked);
    socket.once("close", () => {
      clearTimeout(expiryTimer);
      tracked.sockets.delete(socket);
      tracked.expiryTimers.delete(socket);
      if (tracked.sockets.size === 0) this.sockets.delete(context.sessionId);
    });
  }

  public revokeDevice(deviceId: string): void {
    for (const [sessionId, tracked] of this.sockets) {
      if (tracked.deviceId !== deviceId) continue;
      for (const socket of tracked.sockets) socket.close(4001, "device revoked");
      for (const timer of tracked.expiryTimers.values()) clearTimeout(timer);
      this.sockets.delete(sessionId);
    }
    this.options.store.revokeDevice(deviceId);
  }

  public listDevices(): AuthDeviceRecord[] {
    return this.options.store.listDevices();
  }

  private requireActiveDevice(deviceId: string): AuthDeviceRecord {
    const device = this.options.store.findDevice(deviceId);
    if (!device || device.serverId !== this.serverId || device.status !== "active") {
      throw new AuthStoreError("device_inactive", "device is not active");
    }
    return device;
  }

  private contextForSession(session: AuthSessionRecord): AuthContext | null {
    const device = this.options.store.findDevice(session.deviceId);
    if (!device || device.status !== "active") return null;
    return { ...session, device };
  }
}

export function pairingPayloadUrl(payload: PairingQrPayload): string {
  const encoded = encodeJsonBase64Url(payload);
  const webUrl = new URL(payload.webOrigin);
  webUrl.pathname = `${webUrl.pathname.replace(/\/$/, "")}/settings`;
  webUrl.search = "";
  webUrl.hash = `ma1=${encoded}`;
  return webUrl.toString();
}

function parsePublicKey(value: string): PublicKeyJwk {
  const parsed = JSON.parse(value) as PublicKeyJwk;
  if (parsed.kty !== "EC" || parsed.crv !== "P-256" || typeof parsed.x !== "string" || typeof parsed.y !== "string") {
    throw new AuthStoreError("device_key_invalid", "stored device public key is invalid");
  }
  return parsed;
}

function verifyPublicKeySignature(publicKey: PublicKeyJwk, message: string, signature: string): boolean {
  try {
    return verifySignature(
      "sha256",
      Buffer.from(message, "utf8"),
      { key: createPublicKey({ key: publicKey, format: "jwk" }), dsaEncoding: "ieee-p1363" },
      Buffer.from(decodeBase64Url(signature)),
    );
  } catch {
    return false;
  }
}

function fingerprint(publicKey: PublicKeyJwk): string {
  return createHash("sha256").update(canonicalPublicJwk(publicKey), "utf8").digest("base64url");
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomOpaque(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function encodeJsonBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function isExpired(value: string): boolean {
  return value <= new Date().toISOString();
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}
