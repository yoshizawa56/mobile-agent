import type { AgentdAuthProvider, AgentdConnection } from "@mobile-agent/agentd-client";
import {
  authChallengeRequestSchema,
  authChallengeResponseSchema,
  authInfoSchema,
  authSessionRequestSchema,
  authSessionResponseSchema,
  pairingClaimRequestSchema,
  pairingClaimResponseSchema,
  pairingQrPayloadSchema,
  pairingStatusSchema,
  type PairingQrPayload,
  type PublicKeyJwk,
} from "@mobile-agent/protocol";
import {
  decodeJsonBase64Url,
  encodeJsonBase64Url,
  pairingClaimMessage,
  publicKeyFingerprint,
  sessionMessage,
  sha256Hex,
  signEcdsa,
} from "@mobile-agent/protocol";

type StoredBrowserDevice = {
  serverId: string;
  deviceId: string;
  publicKey: PublicKeyJwk;
  privateKey: CryptoKey;
};

type CachedSession = {
  serverId: string;
  deviceId: string;
  accessToken: string;
  expiresAt: string;
};

const authDatabaseName = "mobile-agent.auth.v1";
const authStoreName = "devices";
const clientVersion = "web";

export type BrowserPairingProgress =
  | { phase: "claiming" }
  | { phase: "awaiting_approval"; fingerprint: string }
  | { phase: "approved" };

export type BrowserPairingResult = {
  payload: PairingQrPayload;
  serverId: string;
  deviceId: string;
  deviceName: string;
};

export function parsePairingQrPayload(value: string, expectedWebOrigin = typeof window === "undefined" ? undefined : window.location.origin): PairingQrPayload {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("QR code does not contain a valid pairing URL");
  }
  const prefix = "#ma1=";
  if (!url.hash.startsWith(prefix)) throw new Error("QR code is not a mobile-agent pairing code");
  const payload = pairingQrPayloadSchema.parse(decodeJsonBase64Url<unknown>(url.hash.slice(prefix.length)));
  if (payload.expiresAt <= Date.now()) throw new Error("This pairing QR code has expired");
  if (expectedWebOrigin && new URL(payload.webOrigin).origin !== expectedWebOrigin) {
    throw new Error("This QR code belongs to a different web origin");
  }
  if (new URL(payload.agentdBaseUrl).protocol !== "http:" && new URL(payload.agentdBaseUrl).protocol !== "https:") {
    throw new Error("Pairing endpoint must use http or https");
  }
  return payload;
}

export async function pairBrowserFromQr(
  value: string,
  options: {
    deviceName: string;
    expectedWebOrigin?: string;
    onProgress?: (progress: BrowserPairingProgress) => void;
  },
): Promise<BrowserPairingResult> {
  const payload = parsePairingQrPayload(value, options.expectedWebOrigin);
  const endpoint = payload.agentdBaseUrl.replace(/\/$/, "");
  const info = authInfoSchema.parse(await requestJson(`${endpoint}/auth/v1/info`));
  if (info.serverId !== payload.serverId) throw new Error("Pairing QR and agentd server identity do not match");
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const parsedPublicKey = publicKeyJwk(publicKey);
  const fingerprint = await publicKeyFingerprint(parsedPublicKey);
  const clientNonce = randomNonce();
  const pairingSecretHash = await sha256Hex(payload.pairingSecret);
  const claimMessage = pairingClaimMessage({
    serverId: payload.serverId,
    pairingId: payload.pairingId,
    pairingSecretHash,
    keyFingerprint: fingerprint,
    clientNonce,
  });

  options.onProgress?.({ phase: "claiming" });
  const claim = pairingClaimResponseSchema.parse(await requestJson(`${endpoint}/auth/v1/pairings/${encodeURIComponent(payload.pairingId)}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pairingClaimRequestSchema.parse({
      pairingSecret: payload.pairingSecret,
      publicKey: parsedPublicKey,
      deviceName: options.deviceName.trim() || defaultDeviceName(),
      deviceType: "browser",
      platform: typeof navigator === "undefined" ? undefined : navigator.platform,
      clientVersion,
      clientNonce,
      signature: await signEcdsa(keyPair.privateKey, claimMessage),
    })),
  }));
  if (claim.serverId !== payload.serverId || claim.pairingId !== payload.pairingId) throw new Error("agentd returned an unexpected pairing identity");
  options.onProgress?.({ phase: "awaiting_approval", fingerprint: claim.keyFingerprint });

  const status = await waitForPairingApproval(endpoint, payload.pairingId, claim.claimToken);
  if (status.status !== "approved" || !status.deviceId) throw new Error(`Pairing was ${status.status}`);
  await saveBrowserDevice({
    serverId: payload.serverId,
    deviceId: status.deviceId,
    publicKey: parsedPublicKey,
    privateKey: keyPair.privateKey,
  });
  options.onProgress?.({ phase: "approved" });
  return { payload, serverId: payload.serverId, deviceId: status.deviceId, deviceName: options.deviceName.trim() || defaultDeviceName() };
}

export function createBrowserAgentdAuth(connection: AgentdConnection): AgentdAuthProvider {
  let cached: CachedSession | undefined;
  const provider: AgentdAuthProvider = {
    getAccessToken: async () => {
      const info = authInfoSchema.parse(await requestJson(`${connection.httpBaseUrl.replace(/\/$/, "")}/auth/v1/info`));
      if (cached && cached.serverId === info.serverId && cached.expiresAt > new Date(Date.now() + 30_000).toISOString()) return cached.accessToken;

      const device = await loadBrowserDevice(info.serverId);
      if (!device) throw new Error("This browser is not paired with agentd");
      const challenge = authChallengeResponseSchema.parse(await requestJson(`${connection.httpBaseUrl.replace(/\/$/, "")}/auth/v1/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authChallengeRequestSchema.parse({ deviceId: device.deviceId })),
      }));
      const signature = await signEcdsa(device.privateKey, sessionMessage({
        serverId: info.serverId,
        deviceId: device.deviceId,
        challengeId: challenge.challengeId,
        challengeNonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      }));
      const session = authSessionResponseSchema.parse(await requestJson(`${connection.httpBaseUrl.replace(/\/$/, "")}/auth/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authSessionRequestSchema.parse({ deviceId: device.deviceId, challengeId: challenge.challengeId, signature })),
      }));
      if (session.serverId !== info.serverId || session.deviceId !== device.deviceId) throw new Error("agentd returned an unexpected session identity");
      cached = { serverId: session.serverId, deviceId: session.deviceId, accessToken: session.accessToken, expiresAt: session.expiresAt };
      return session.accessToken;
    },
    getWebSocketTicket: async (endpoint) => {
      const accessToken = await provider.getAccessToken();
      const response = await requestJson(`${connection.httpBaseUrl.replace(/\/$/, "")}/auth/v1/ws-tickets`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ endpoint }),
      });
      return (response as { ticket: string }).ticket;
    },
  };
  return provider;
}

async function waitForPairingApproval(endpoint: string, pairingId: string, claimToken: string): Promise<{ status: "offered" | "awaiting_approval" | "approved" | "rejected" | "expired"; deviceId: string | null }> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const status = pairingStatusSchema.parse(await requestJson(`${endpoint}/auth/v1/pairings/${encodeURIComponent(pairingId)}`, {
      headers: { authorization: `Pairing ${claimToken}` },
    }));
    if (status.status === "approved" || status.status === "rejected" || status.status === "expired") return status;
    await wait(1_000);
  }
  throw new Error("Pairing approval timed out");
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : `agentd returned ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function publicKeyJwk(value: JsonWebKey): PublicKeyJwk {
  if (value.kty !== "EC" || value.crv !== "P-256" || !value.x || !value.y) throw new Error("browser could not export a P-256 public key");
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y };
}

function randomNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeJsonBase64Url([...bytes]);
}

function defaultDeviceName(): string {
  return typeof navigator === "undefined" ? "Browser" : navigator.userAgent.slice(0, 80) || "Browser";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function openAuthDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("This browser does not support secure key storage");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(authDatabaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(authStoreName, { keyPath: "serverId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open browser key storage"));
  });
}

async function saveBrowserDevice(device: StoredBrowserDevice): Promise<void> {
  const database = await openAuthDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(authStoreName, "readwrite");
    transaction.objectStore(authStoreName).put(device);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("could not store browser key"));
  });
  database.close();
}

async function loadBrowserDevice(serverId: string): Promise<StoredBrowserDevice | null> {
  const database = await openAuthDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(authStoreName, "readonly").objectStore(authStoreName).get(serverId);
    request.onsuccess = () => {
      database.close();
      resolve((request.result as StoredBrowserDevice | undefined) ?? null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("could not read browser key"));
    };
  });
}
