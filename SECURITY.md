# Security policy

## Scope and status

This project is pre-alpha. It controls terminals and agent processes, so a vulnerability may expose command execution, terminal output, credentials available to the host account, or local files. Treat the current deployment model as a security boundary with known limitations, not as a completed security product.

The supported public-reporting path is the repository's [private security advisory form](https://github.com/yoshizawa56/mobile-agent/security/advisories/new). If private advisories are unavailable, contact the maintainer privately through GitHub before publishing details.

## Current deployment boundary

`agentd` is intended to bind to loopback and be reached through Tailscale Serve and its ACLs. Do not expose the HTTP or WebSocket port directly to the public internet.

The current MVP does not yet provide application-level pairing or bearer-token authentication. Tailscale identity/ACLs are therefore part of the deployment boundary until that layer is implemented.

The browser client stores only a non-secret Serve URL. SSH keys, passwords, Tailscale auth keys, API keys, and agent credentials must not be put in the repository, browser storage, fixtures, Storybook data, or issue reports. A future native SSH adapter must keep private material in the OS secure store.

Known limitations in the current MVP:

- application-level pairing and per-device authorization are not implemented;
- identity headers from Tailscale Serve are not yet independently verified by agentd;
- agentd can control the host user's tmux sessions and processes;
- plugin code runs with the privileges of the agentd host process.

## Supply-chain controls

The repository applies two baseline controls to dependency and CI supply chains:

- pnpm will not install a newly published package until it is at least seven days old. The policy is strict and fails when no eligible version exists or registry publication-time metadata is missing.
- GitHub Actions references are pinned to full commit SHAs rather than mutable version tags. The public-repository audit checks workflow files and fails if a future action reference is not SHA-pinned.

These controls reduce exposure to short-lived malicious releases and moved action tags, but they do not replace review of dependency updates, lockfile changes, action provenance, or runner security.

Do not use the MVP with untrusted tailnet users or with a public, unauthenticated proxy.

## Reporting a vulnerability

Please use GitHub's private security advisory flow for this repository when it is enabled. Do not include credentials, private keys, terminal output, or personal data in a public issue.

## Release checklist

Before publishing a commit or release, run:

```sh
pnpm audit:public
pnpm typecheck
pnpm test
pnpm build
```

Review the complete staged diff and the relevant Git history. If a secret has ever been committed, assume it is compromised: revoke or rotate it first, then remove it from history with an agreed repository-wide procedure.
