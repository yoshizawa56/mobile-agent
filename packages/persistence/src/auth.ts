import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";

export type AuthDeviceType = "browser" | "native" | "cli";
export type AuthDeviceStatus = "active" | "revoked";
export type AuthPairingStatus = "offered" | "awaiting_approval" | "approved" | "rejected" | "expired";

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

export class AuthStore {
  public constructor(private readonly sqlite: Database) {}

  public getServerId(): string {
    const existing = this.sqlite.prepare("SELECT server_id AS serverId FROM auth_metadata WHERE id = 1").get() as { serverId?: string } | null;
    if (existing?.serverId) return existing.serverId;

    const serverId = randomOpaque(16);
    const now = timestamp();
    this.sqlite.transaction(() => {
      const current = this.sqlite.prepare("SELECT server_id AS serverId FROM auth_metadata WHERE id = 1").get() as { serverId?: string } | null;
      if (!current?.serverId) {
        this.sqlite.prepare("INSERT INTO auth_metadata (id, server_id, created_at) VALUES (1, ?, ?)").run(serverId, now);
      }
    }).immediate();

    const row = this.sqlite.prepare("SELECT server_id AS serverId FROM auth_metadata WHERE id = 1").get() as { serverId?: string } | null;
    if (!row?.serverId) throw new AuthStoreError("auth_metadata_missing", "muximod authentication metadata could not be initialized");
    return row.serverId;
  }

  public createPairing(input: CreatePairingInput): CreatePairingResult {
    const serverId = this.getServerId();
    const pairingId = randomOpaque(16);
    this.sqlite.prepare(`
      INSERT INTO auth_pairings (
        pairing_id, server_id, web_origin, muximod_base_url, secret_hash, status,
        offered_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'offered', ?, ?)
    `).run(
      pairingId,
      serverId,
      // Keep the legacy NOT NULL column populated for databases created by
      // v1. It is no longer part of the pairing model or returned to clients.
      "",
      input.muximodBaseUrl,
      hashOpaque(input.secret),
      timestamp(),
      input.expiresAt,
    );
    return {
      pairingId,
      serverId,
      secret: input.secret,
      muximodBaseUrl: input.muximodBaseUrl,
      expiresAt: input.expiresAt,
    };
  }

  public findPairing(pairingId: string): AuthPairingRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM auth_pairings WHERE pairing_id = ?").get(pairingId) as AuthPairingRow | null;
    if (!row) return null;
    const pairing = toPairingRecord(row);
    if (isExpired(pairing.expiresAt) && pairing.status === "offered") {
      this.sqlite.prepare("UPDATE auth_pairings SET status = 'expired' WHERE pairing_id = ? AND status = 'offered'").run(pairingId);
      return { ...pairing, status: "expired" };
    }
    if (pairing.claimExpiresAt && isExpired(pairing.claimExpiresAt) && pairing.status === "awaiting_approval") {
      this.sqlite.prepare("UPDATE auth_pairings SET status = 'expired' WHERE pairing_id = ? AND status = 'awaiting_approval'").run(pairingId);
      return { ...pairing, status: "expired" };
    }
    return pairing;
  }

  public claimPairing(input: ClaimPairingInput): ClaimPairingResult {
    const claim = this.sqlite.transaction(() => {
      const row = this.sqlite.prepare("SELECT * FROM auth_pairings WHERE pairing_id = ?").get(input.pairingId) as AuthPairingRow | null;
      if (!row) throw new AuthStoreError("pairing_not_found", "pairing was not found");
      const pairing = toPairingRecord(row);
      if (pairing.serverId !== this.getServerId()) throw new AuthStoreError("wrong_server", "pairing belongs to another authentication realm");
      if (pairing.status !== "offered") throw new AuthStoreError("pairing_unavailable", "pairing is no longer available");
      if (isExpired(pairing.expiresAt)) {
        this.sqlite.prepare("UPDATE auth_pairings SET status = 'expired' WHERE pairing_id = ?").run(input.pairingId);
        throw new AuthStoreError("pairing_expired", "pairing has expired");
      }
      const storedSecretHash = row.secret_hash;
      if (!timingSafeEqualText(storedSecretHash, input.secretHash)) throw new AuthStoreError("pairing_invalid", "pairing secret is invalid");

      this.sqlite.prepare(`
        UPDATE auth_pairings
        SET claim_token_hash = ?, status = 'awaiting_approval', claim_expires_at = ?, claimed_at = ?,
            pending_public_key_jwk = ?, pending_fingerprint = ?, pending_display_name = ?,
            pending_device_type = ?, pending_platform = ?, pending_client_version = ?
        WHERE pairing_id = ? AND status = 'offered'
      `).run(
        hashOpaque(input.claimToken),
        input.claimExpiresAt,
        timestamp(),
        input.publicKeyJwk,
        input.keyFingerprint,
        input.displayName,
        input.deviceType,
        input.platform,
        input.clientVersion,
        input.pairingId,
      );

      const updated = this.sqlite.prepare("SELECT * FROM auth_pairings WHERE pairing_id = ?").get(input.pairingId) as AuthPairingRow | null;
      if (!updated || updated.status !== "awaiting_approval") throw new AuthStoreError("pairing_race", "pairing was claimed by another client");
      return toPairingRecord(updated);
    }).immediate();

    return { pairing: claim, claimToken: input.claimToken };
  }

  public getPairingStatus(pairingId: string, claimToken: string): { status: AuthPairingStatus; deviceId: string | null } {
    const pairing = this.findPairing(pairingId);
    if (!pairing) throw new AuthStoreError("pairing_not_found", "pairing was not found");
    const row = this.sqlite.prepare("SELECT claim_token_hash AS claimTokenHash, claim_expires_at AS claimExpiresAt FROM auth_pairings WHERE pairing_id = ?").get(pairingId) as { claimTokenHash?: string; claimExpiresAt?: string | null } | null;
    if (!row?.claimTokenHash || !timingSafeEqualText(row.claimTokenHash, hashOpaque(claimToken))) {
      throw new AuthStoreError("claim_token_invalid", "claim token is invalid");
    }
    if (!row.claimExpiresAt || isExpired(row.claimExpiresAt)) throw new AuthStoreError("claim_token_expired", "claim token has expired");
    return { status: pairing.status, deviceId: pairing.deviceId };
  }

  public approvePairing(pairingId: string): AuthDeviceRecord {
    const device = this.sqlite.transaction(() => {
      const row = this.sqlite.prepare("SELECT * FROM auth_pairings WHERE pairing_id = ?").get(pairingId) as AuthPairingRow | null;
      if (!row) throw new AuthStoreError("pairing_not_found", "pairing was not found");
      const pairing = toPairingRecord(row);
      if (pairing.status !== "awaiting_approval" || !pairing.pendingPublicKeyJwk || !pairing.pendingFingerprint) {
        throw new AuthStoreError("pairing_not_awaiting_approval", "pairing is not awaiting approval");
      }
      if (!pairing.claimExpiresAt || isExpired(pairing.claimExpiresAt)) {
        this.sqlite.prepare("UPDATE auth_pairings SET status = 'expired' WHERE pairing_id = ?").run(pairingId);
        throw new AuthStoreError("pairing_expired", "pairing approval has expired");
      }

      const deviceId = `device-${randomOpaque(16)}`;
      const approvedAt = timestamp();
      this.sqlite.prepare(`
        INSERT INTO auth_devices (
          device_id, server_id, public_key_jwk, key_fingerprint, display_name, device_type,
          platform, client_version, status, created_at, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        deviceId,
        pairing.serverId,
        pairing.pendingPublicKeyJwk,
        pairing.pendingFingerprint,
        pairing.pendingDisplayName ?? "Unnamed device",
        pairing.pendingDeviceType ?? "browser",
        pairing.pendingPlatform,
        pairing.pendingClientVersion,
        approvedAt,
        approvedAt,
      );
      this.sqlite.prepare("UPDATE auth_pairings SET status = 'approved', approved_at = ?, device_id = ? WHERE pairing_id = ?").run(approvedAt, deviceId, pairingId);
      const inserted = this.sqlite.prepare("SELECT * FROM auth_devices WHERE device_id = ?").get(deviceId) as AuthDeviceRow | null;
      if (!inserted) throw new AuthStoreError("device_registration_failed", "device registration failed");
      return toDeviceRecord(inserted);
    }).immediate();
    return device;
  }

  public rejectPairing(pairingId: string): void {
    const result = this.sqlite.prepare("UPDATE auth_pairings SET status = 'rejected' WHERE pairing_id = ? AND status IN ('offered', 'awaiting_approval')").run(pairingId);
    if (result.changes === 0) throw new AuthStoreError("pairing_not_rejectable", "pairing is no longer pending");
  }

  public findDevice(deviceId: string): AuthDeviceRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM auth_devices WHERE device_id = ?").get(deviceId) as AuthDeviceRow | null;
    return row ? toDeviceRecord(row) : null;
  }

  public createSession(input: { sessionId: string; token: string; deviceId: string; expiresAt: string }): AuthSessionRecord {
    const device = this.findDevice(input.deviceId);
    if (!device || device.status !== "active") throw new AuthStoreError("device_inactive", "device is not active");
    const issuedAt = timestamp();
    this.sqlite.prepare(`
      INSERT INTO auth_sessions (session_id, server_id, device_id, token_hash, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.sessionId, device.serverId, input.deviceId, hashOpaque(input.token), issuedAt, input.expiresAt);
    return { sessionId: input.sessionId, serverId: device.serverId, deviceId: input.deviceId, issuedAt, expiresAt: input.expiresAt, revokedAt: null };
  }

  public findSession(token: string): AuthSessionRecord | null {
    const now = timestamp();
    const row = this.sqlite.prepare(`
      SELECT s.session_id AS sessionId, s.server_id AS serverId, s.device_id AS deviceId,
             s.issued_at AS issuedAt, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
             d.status AS deviceStatus
      FROM auth_sessions s
      JOIN auth_devices d ON d.device_id = s.device_id
      WHERE s.token_hash = ?
    `).get(hashOpaque(token)) as (AuthSessionRow & { deviceStatus?: string }) | null;
    if (!row || row.deviceStatus !== "active" || row.revokedAt || row.expiresAt <= now) return null;
    this.sqlite.prepare("UPDATE auth_sessions SET last_used_at = ? WHERE session_id = ?").run(now, row.sessionId);
    this.sqlite.prepare("UPDATE auth_devices SET last_seen_at = ? WHERE device_id = ?").run(now, row.deviceId);
    return {
      sessionId: row.sessionId,
      serverId: row.serverId,
      deviceId: row.deviceId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
    };
  }

  public findSessionById(sessionId: string): AuthSessionRecord | null {
    const row = this.sqlite.prepare(`
      SELECT session_id AS sessionId, server_id AS serverId, device_id AS deviceId,
             issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt
      FROM auth_sessions
      WHERE session_id = ?
    `).get(sessionId) as AuthSessionRow | null;
    if (!row || row.revokedAt || row.expiresAt <= timestamp()) return null;
    const device = this.findDevice(row.deviceId);
    if (!device || device.status !== "active") return null;
    return {
      sessionId: row.sessionId,
      serverId: row.serverId,
      deviceId: row.deviceId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
    };
  }

  public revokeSession(sessionId: string): void {
    this.sqlite.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL").run(timestamp(), sessionId);
  }

  public revokeDevice(deviceId: string): void {
    const now = timestamp();
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE auth_devices SET status = 'revoked', revoked_at = ? WHERE device_id = ? AND status = 'active'").run(now, deviceId);
      this.sqlite.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL").run(now, deviceId);
    }).immediate();
  }

  public listDevices(): AuthDeviceRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM auth_devices ORDER BY created_at ASC").all() as AuthDeviceRow[];
    return rows.map(toDeviceRecord);
  }
}

type AuthPairingRow = {
  pairing_id: string;
  server_id: string;
  web_origin: string;
  muximod_base_url: string;
  secret_hash: string;
  claim_token_hash: string | null;
  status: string;
  offered_at: string;
  expires_at: string;
  claim_expires_at: string | null;
  claimed_at: string | null;
  approved_at: string | null;
  pending_public_key_jwk: string | null;
  pending_fingerprint: string | null;
  pending_display_name: string | null;
  pending_device_type: AuthDeviceType | null;
  pending_platform: string | null;
  pending_client_version: string | null;
  device_id: string | null;
};

type AuthDeviceRow = {
  device_id: string;
  server_id: string;
  public_key_jwk: string;
  key_fingerprint: string;
  display_name: string;
  device_type: AuthDeviceType;
  platform: string | null;
  client_version: string | null;
  status: AuthDeviceStatus;
  created_at: string;
  approved_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

type AuthSessionRow = {
  sessionId: string;
  serverId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

function toPairingRecord(row: AuthPairingRow): AuthPairingRecord {
  return {
    pairingId: row.pairing_id,
    serverId: row.server_id,
    muximodBaseUrl: row.muximod_base_url,
    status: row.status as AuthPairingStatus,
    offeredAt: row.offered_at,
    expiresAt: row.expires_at,
    claimExpiresAt: row.claim_expires_at,
    claimedAt: row.claimed_at,
    approvedAt: row.approved_at,
    pendingPublicKeyJwk: row.pending_public_key_jwk,
    pendingFingerprint: row.pending_fingerprint,
    pendingDisplayName: row.pending_display_name,
    pendingDeviceType: row.pending_device_type,
    pendingPlatform: row.pending_platform,
    pendingClientVersion: row.pending_client_version,
    deviceId: row.device_id,
  };
}

function toDeviceRecord(row: AuthDeviceRow): AuthDeviceRecord {
  return {
    deviceId: row.device_id,
    serverId: row.server_id,
    publicKeyJwk: row.public_key_jwk,
    keyFingerprint: row.key_fingerprint,
    displayName: row.display_name,
    deviceType: row.device_type,
    platform: row.platform,
    clientVersion: row.client_version,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

function randomOpaque(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timingSafeEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function timestamp(): string {
  return new Date().toISOString();
}

function isExpired(value: string): boolean {
  return value <= timestamp();
}
