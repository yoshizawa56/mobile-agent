---
name: muximo-auth-boundary
description: Apply when modifying QR pairing, device authentication, auth routes, public-key crypto, browser key storage, bearer sessions, WebSocket tickets, CORS, Origin checks, or sensitive logging. Enforce Muximo's credential ownership, authentication boundaries, and replay-prevention rules.
---

# Muximo Auth Boundary

Use this skill when a change can create, validate, store, transport, log, or revoke a credential, or can expose an authenticated HTTP/WebSocket route.

## Rules

- Every operation under `/api`, `/terminal`, and `/events` must remain inside the device-authentication boundary. Do not treat network reachability, CORS, `Origin`, or Tailscale ACLs as authorization.
- Pairing requires the short-lived QR secret, a client proof-of-possession signature, and explicit host approval through the local control channel.
- Device private keys stay on the client. The host stores only the device public key and hashes of opaque credentials. Browser private keys must remain non-extractable and must not be placed in Web Storage.
- HTTP uses the authenticated access-token flow. WebSockets use a short-lived, endpoint-bound, one-use ticket; never place an access token in a WebSocket URL.
- Do not write pairing secrets, private keys, access tokens, WebSocket tickets, terminal resume tokens, terminal output, or URLs containing them to logs, telemetry, diagnostics, or persistent browser storage.
- Preserve device/session binding and reject expired, revoked, wrong-endpoint, replayed, and wrong-environment credentials.

Use the protocol schemas, crypto helpers, authentication service, browser auth provider, and their tests as the protocol source of truth. Keep this skill focused on invariants; do not duplicate TTL tables or message formats here.
