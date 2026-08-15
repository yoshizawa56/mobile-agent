import type { AgentdApplication, AgentdHookEvent as ApplicationHookEvent, AgentdSocket } from "@mobile-agent/application";
import type {
  AuthChallengeResponse,
  AuthSessionResponse,
  PairingClaimRequest,
  PairingClaimResponse,
  PairingStatus,
  WsTicketResponse,
} from "@mobile-agent/protocol";

export type AgentdHookEvent = ApplicationHookEvent;

export type AgentdHttpStatus = 400 | 401 | 403 | 404 | 409 | 410 | 426 | 429 | 500 | 503;

export type AgentdAuthDevice = {
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

export type AgentdAuthContext = {
  sessionId: string;
  serverId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  device: AgentdAuthDevice;
};

export interface AgentdAuthPort {
  readonly serverId: string;
  allowsWebOrigin(origin: string | undefined): boolean;
  authenticateAccessToken(token: string | undefined): AgentdAuthContext | null;
  claimPairing(pairingId: string, request: PairingClaimRequest): PairingClaimResponse;
  pairingStatus(pairingId: string, claimToken: string): PairingStatus;
  createChallenge(deviceId: string): AuthChallengeResponse;
  createSession(input: { deviceId: string; challengeId: string; signature: string }): AuthSessionResponse;
  issueWebSocketTicket(context: AgentdAuthContext, endpoint: "terminal" | "events"): WsTicketResponse;
  consumeWebSocketTicket(ticket: string | undefined, endpoint: "terminal" | "events"): AgentdAuthContext | null;
}

export type AgentdHttpLogger = {
  debug(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

export type AgentdHttpDependencies = {
  auth: AgentdAuthPort;
  application: AgentdApplication;
  isReady?: () => boolean;
  corsOrigin: string;
  hookToken: string;
  onTerminalConnection?: (socket: AgentdSocket, context: AgentdAuthContext) => void;
  onEventsConnection?: (socket: AgentdSocket, context: AgentdAuthContext) => void;
  logger?: AgentdHttpLogger;
};
