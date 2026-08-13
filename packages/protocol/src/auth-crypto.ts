import type { PublicKeyJwk } from "./index.js";

export function canonicalPublicJwk(jwk: PublicKeyJwk): string {
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

export function pairingClaimMessage(input: {
  serverId: string;
  pairingId: string;
  pairingSecretHash: string;
  keyFingerprint: string;
  clientNonce: string;
}): string {
  return [
    "MA-PAIR-CLAIM-V1",
    input.serverId,
    input.pairingId,
    input.pairingSecretHash,
    input.keyFingerprint,
    input.clientNonce,
  ].join("\n") + "\n";
}

export function sessionMessage(input: {
  serverId: string;
  deviceId: string;
  challengeId: string;
  challengeNonce: string;
  expiresAt: string;
}): string {
  return [
    "MA-SESSION-V1",
    input.serverId,
    input.deviceId,
    input.challengeId,
    input.challengeNonce,
    input.expiresAt,
  ].join("\n") + "\n";
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function publicKeyFingerprint(jwk: PublicKeyJwk): Promise<string> {
  return sha256Base64Url(canonicalPublicJwk(jwk));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signEcdsa(privateKey: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(message),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export function encodeJsonBase64Url(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeJsonBase64Url<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}
