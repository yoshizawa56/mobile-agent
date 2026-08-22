export type AuthDeviceType = "browser" | "native" | "cli";
export type AuthDeviceStatus = "active" | "revoked";
export type AuthPairingStatus = "offered" | "awaiting_approval" | "approved" | "rejected" | "expired";

import type { PublicKeyJwk } from "@muximo/domain";

export type { PublicKeyJwk } from "@muximo/domain";

export type AuthDeviceRecord = {
  deviceId: string;
  serverId: string;
  publicKeyJwk: string;
  keyFingerprint: string;
  displayName: string;
  deviceType: AuthDeviceType;
  platform: string | null;
  clientVersion: string | null;
  status: AuthDeviceStatus;
  createdAt: string;
  approvedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type AuthPairingRecord = {
  pairingId: string;
  serverId: string;
  muximodBaseUrl: string;
  status: AuthPairingStatus;
  offeredAt: string;
  expiresAt: string;
  claimExpiresAt: string | null;
  claimedAt: string | null;
  approvedAt: string | null;
  pendingPublicKeyJwk: string | null;
  pendingFingerprint: string | null;
  pendingDisplayName: string | null;
  pendingDeviceType: AuthDeviceType | null;
  pendingPlatform: string | null;
  pendingClientVersion: string | null;
  deviceId: string | null;
};

export type AuthSessionRecord = {
  sessionId: string;
  serverId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type CreatePairingInput = {
  muximodBaseUrl: string;
  expiresAt: string;
  secret: string;
};

export type CreatePairingResult = {
  pairingId: string;
  serverId: string;
  secret: string;
  muximodBaseUrl: string;
  expiresAt: string;
};

export type ClaimPairingInput = {
  pairingId: string;
  secretHash: string;
  claimToken: string;
  claimExpiresAt: string;
  publicKeyJwk: string;
  keyFingerprint: string;
  displayName: string;
  deviceType: AuthDeviceType;
  platform: string | null;
  clientVersion: string | null;
};

export type ClaimPairingResult = {
  pairing: AuthPairingRecord;
  claimToken: string;
};

export class AuthStoreError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AuthStoreError";
  }
}

/** Persistence operations required by the authentication use case. */
export interface AuthStorePort {
  getServerId(): string;
  createPairing(input: CreatePairingInput): CreatePairingResult;
  findPairing(pairingId: string): AuthPairingRecord | null;
  claimPairing(input: ClaimPairingInput): ClaimPairingResult;
  getPairingStatus(pairingId: string, claimToken: string): { status: AuthPairingStatus; deviceId: string | null };
  approvePairing(pairingId: string): AuthDeviceRecord;
  rejectPairing(pairingId: string): void;
  findDevice(deviceId: string): AuthDeviceRecord | null;
  createSession(input: { sessionId: string; token: string; deviceId: string; expiresAt: string }): AuthSessionRecord;
  findSession(token: string): AuthSessionRecord | null;
  findSessionById(sessionId: string): AuthSessionRecord | null;
  revokeSession(sessionId: string): void;
  revokeDevice(deviceId: string): void;
  listDevices(): AuthDeviceRecord[];
}

export type AuthPairingClaimRequest = {
  pairingSecret: string;
  publicKey: PublicKeyJwk;
  deviceName: string;
  deviceType: AuthDeviceType;
  platform?: string;
  clientVersion?: string;
  clientNonce: string;
  signature: string;
};

export type AuthPairingClaimResponse = {
  serverId: string;
  pairingId: string;
  claimToken: string;
  status: "awaiting_approval";
  expiresAt: string;
  keyFingerprint: string;
};

export type AuthPairingPayload = {
  v: 2;
  muximodBaseUrl: string;
  serverId: string;
  pairingId: string;
  pairingSecret: string;
  expiresAt: number;
};

export type AuthPairingClaimNotification = {
  pairingId: string;
  serverId: string;
  deviceName: string;
  deviceType: AuthDeviceType;
  platform: string | null;
  clientVersion: string | null;
  keyFingerprint: string;
  expiresAt: string;
};

export type AuthChallengeResponse = {
  serverId: string;
  deviceId: string;
  challengeId: string;
  nonce: string;
  expiresAt: string;
};

export type AuthSessionResponse = {
  serverId: string;
  deviceId: string;
  sessionId: string;
  accessToken: string;
  expiresAt: string;
};

export type WsTicketResponse = {
  ticket: string;
  endpoint: "terminal";
  expiresAt: string;
};

export type MuximodAuthDevice = AuthDeviceRecord;

export type MuximodAuthContext = AuthSessionRecord & {
  device: MuximodAuthDevice;
};

/** Authentication operations exposed to the private host control adapter. */
export interface MuximodAuthControlPort {
  createPairing(overrides?: { muximodBaseUrl?: string }): AuthPairingPayload;
  approvePairing(pairingId: string): AuthDeviceRecord;
  rejectPairing(pairingId: string): void;
  setPairingClaimListener(listener: ((notification: AuthPairingClaimNotification) => void) | undefined): void;
}

export interface AuthCryptoPort {
  randomOpaque(bytes: number): string;
  hashOpaque(value: string): string;
  fingerprint(publicKey: PublicKeyJwk): string;
  pairingClaimMessage(input: { serverId: string; pairingId: string; pairingSecretHash: string; keyFingerprint: string; clientNonce: string }): string;
  sessionMessage(input: { serverId: string; deviceId: string; challengeId: string; challengeNonce: string; expiresAt: string }): string;
  verifyPublicKeySignature(publicKey: PublicKeyJwk, message: string, signature: string): boolean;
  parsePublicKey(value: string): PublicKeyJwk;
}

export interface MuximodAuthPort {
  readonly serverId: string;
  authenticateAccessToken(token: string | undefined): MuximodAuthContext | null;
  claimPairing(pairingId: string, request: AuthPairingClaimRequest): AuthPairingClaimResponse;
  pairingStatus(pairingId: string, claimToken: string): { status: AuthPairingStatus; deviceId: string | null };
  createChallenge(deviceId: string): AuthChallengeResponse;
  createSession(input: { deviceId: string; challengeId: string; signature: string }): AuthSessionResponse;
  issueWebSocketTicket(context: MuximodAuthContext, endpoint: "terminal"): WsTicketResponse;
  consumeWebSocketTicket(ticket: string | undefined, endpoint: "terminal"): MuximodAuthContext | null;
}
