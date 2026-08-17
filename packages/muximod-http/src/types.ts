import type { MuximodApplication, MuximodHookEvent as ApplicationHookEvent, MuximodSocket } from "@muximo/application";
import type {
  AuthChallengeResponse,
  AuthSessionResponse,
  PairingClaimRequest,
  PairingClaimResponse,
  PairingStatus,
  WsTicketResponse,
} from "@muximo/protocol";

export type MuximodHookEvent = ApplicationHookEvent;

export type MuximodHttpStatus = 400 | 401 | 403 | 404 | 409 | 410 | 426 | 429 | 500 | 503;

export type MuximodAuthDevice = {
  deviceId: string;
  serverId: string;
  publicKeyJwk: string;
  keyFingerprint: string;
  displayName: string;
  deviceType: "browser" | "native" | "cli";
  platform: string | null;
  clientVersion: string | null;
  status: "active" | "revoked";
  createdAt: string;
  approvedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type MuximodAuthContext = {
  sessionId: string;
  serverId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  device: MuximodAuthDevice;
};

export interface MuximodAuthPort {
  readonly serverId: string;
  authenticateAccessToken(token: string | undefined): MuximodAuthContext | null;
  claimPairing(pairingId: string, request: PairingClaimRequest): PairingClaimResponse;
  pairingStatus(pairingId: string, claimToken: string): PairingStatus;
  createChallenge(deviceId: string): AuthChallengeResponse;
  createSession(input: { deviceId: string; challengeId: string; signature: string }): AuthSessionResponse;
  issueWebSocketTicket(context: MuximodAuthContext, endpoint: "terminal" | "events"): WsTicketResponse;
  consumeWebSocketTicket(ticket: string | undefined, endpoint: "terminal" | "events"): MuximodAuthContext | null;
}

export type MuximodHttpLogger = {
  debug(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

export type MuximodHttpDependencies = {
  auth: MuximodAuthPort;
  application: MuximodApplication;
  isReady?: () => boolean;
  corsOrigin: string;
  hookToken: string;
  onTerminalConnection?: (socket: MuximodSocket, context: MuximodAuthContext) => void;
  onEventsConnection?: (socket: MuximodSocket, context: MuximodAuthContext) => void;
  logger?: MuximodHttpLogger;
};
