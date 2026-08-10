# Security policy

## Current deployment boundary

`agentd` is intended to bind to loopback and be reached through Tailscale Serve and its ACLs. Do not expose the HTTP or WebSocket port directly to the public internet.

The current MVP does not yet provide application-level pairing or bearer-token authentication. Tailscale identity/ACLs are therefore part of the deployment boundary until that layer is implemented.

## Reporting a vulnerability

Please use GitHub's private security advisory flow for this repository when it is enabled. Do not include credentials, private keys, terminal output, or personal data in a public issue.
