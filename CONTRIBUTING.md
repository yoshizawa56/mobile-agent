# Contributing to mobile-agent

Thank you for helping build a safer, more useful way to operate terminal agents remotely.

## Before you start

- Read the [README](README.md) and [security policy](SECURITY.md).
- Use the repository toolchain managed by [`mise.toml`](mise.toml).
- Never put SSH keys, Tailscale auth keys, API keys, passwords, private terminal output, or personal data in commits, fixtures, screenshots, or issue reports.
- Run `pnpm audit:public` before opening a pull request.

The project is currently pre-alpha. Interfaces may change without a compatibility promise while the core architecture is being stabilized.

## Development setup

```sh
mise install
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

The runtime dependencies are a local `tmux` installation and a supported Node.js runtime. The browser mock mode can be used without a running `agentd`:

```sh
VITE_AGENTD_MOCK_MODE=true pnpm --filter @mobile-agent/web dev
```

## Pull requests

1. Keep changes focused and explain the user-visible or architectural impact.
2. Add or update table-driven tests for domain, application, adapter, and HTTP behavior.
3. Add or update Storybook stories for meaningful view states.
4. Update the architecture or security documentation when behavior or trust boundaries change.
5. Run `pnpm audit:public`, `pnpm typecheck`, `pnpm test`, and `pnpm build` locally.
6. Do not include generated output, local databases, logs, credentials, or machine-specific paths.

## Agent plugins

New agent integrations should implement the plugin boundary in `packages/agents` and keep tool-specific behavior out of the domain package. Plugin tests must cover normal completion, input-waiting state, failure, cancellation, and cleanup.

## Commit and review guidance

Use a short imperative commit subject. Reviewers will prioritize correctness of terminal I/O, tmux ownership and restoration, credential boundaries, and recovery behavior over cosmetic changes.

If a change affects a security boundary, describe the threat model and the negative case in the pull request. Please do not publish a vulnerability in a normal issue.
