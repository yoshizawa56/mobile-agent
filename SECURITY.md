# Security policy

## Status and deployment boundary

Muximo is pre-alpha software. It can read and control the host user's tmux sessions and processes, and agent plugins run with the privileges of the `muximod` process. Do not use it with untrusted users or expose the muximod HTTP and WebSocket ports directly to the public internet.

Keep `muximod` on loopback and expose it through a trusted HTTPS route such as Tailscale Serve. Network reachability alone is not the application authorization boundary: clients must complete QR pairing, host approval, and device authentication before accessing protected API or WebSocket routes.

The browser stores its device private key in non-extractable browser key storage. The host stores the device public key and credential verifiers; access sessions and WebSocket connections are short-lived and bound to the authenticated device. Do not put private keys, pairing secrets, access tokens, passwords, API keys, or private terminal output in the repository, browser Web Storage, fixtures, screenshots, logs, telemetry, or issue reports.

Application-level authorization does not sandbox the host process or third-party plugins. Native secure key-store integration, server identity pinning, end-to-end encryption, and role-based access control are not part of the current release.

## Reporting a vulnerability

Please use the repository's [private security advisory form](https://github.com/yoshizawa56/muximo/security/advisories/new). If private advisories are unavailable, contact the maintainer privately through GitHub before publishing details.

Do not include credentials, private keys, terminal output, or personal data in a public issue. If a secret has been committed, assume it is compromised and revoke or rotate it before investigating repository history.
