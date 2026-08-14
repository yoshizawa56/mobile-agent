# Contributing to mobile-agent

Thank you for helping build a safer, more useful way to operate terminal agents remotely.

## Before you start

- Read the [README](README.md) and [security policy](SECURITY.md).
- Use the repository toolchain managed by [`mise.toml`](mise.toml).
- Never put SSH keys, Tailscale auth keys, API keys, passwords, private terminal output, or personal data in commits, fixtures, screenshots, or issue reports.
- Run `bun run audit:public` before opening a pull request.

The project is currently pre-alpha. Interfaces may change without a compatibility promise while the core architecture is being stabilized.

Reusable worktree setup and cleanup hook examples live in [`examples/hooks`](examples/hooks/README.md). Keep hooks idempotent, avoid committing local databases or credentials, and remember that registered hook paths are host-side executable paths.

## Development setup

```sh
mise install
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

`bun run dev` is the recommended dogfooding entrypoint. It starts or reuses healthy `agentd` and web services, checks the HTTP/API/WebSocket routes before reporting ready, stops the child process groups it owns when the session ends, and prints recovery instructions for port conflicts. It does not automatically restart failed services or install system dependencies. Tailscale Serve remains opt-in; use `agent dev serve tailscale` (or `mise run dev-serve`) when the Tailscale CLI is already installed and configured. The command starts the local stack, upserts the fixed Serve route, and leaves that route configured when the local processes stop.

The runtime dependencies are Bun, the pinned Node LTS runtime, and a local `tmux` installation. Bun runs the workspace scripts and agentd; Node runs Vite, Storybook, Vitest, and TypeScript for the Web package. The browser mock mode can be used without a running `agentd`:

```sh
VITE_AGENTD_MOCK_MODE=true bun run --filter @mobile-agent/web dev
```

## Table-driven tests

Every behavior test uses `@mobile-agent/test-support` with one table-level `execute` and `observe`. A row contains only a unique `name`, optional `fixture`, declarative `input` or typed `steps`, and a non-empty list of named assertions. Fixtures include DI and environment setup; a selected fixture completely replaces the lazy default for that row.

Use `runOperationTable` for one public operation and `runScenarioTable` for typed multi-step protocols. The lifecycle is `fixture -> execute -> observe -> assertAll -> cleanup`. `observe` is post-execution and read-only. Unexpected execute errors fail the row unless `hasError(...)` or a custom outcome-aware assertion explicitly handles them. All assertions run and their diffs and stacks are aggregated. Cleanup callbacks run in LIFO order even when setup or assertions fail.

Use the standard helpers `hasNoError()`, `returns(expected)`, `hasError(...)`, `hasObserved(...)`, `hasCalls(...)`, and `hasEvents(...)` before writing a custom named assertion. Do not use bare `it`/`test`, direct `*.each`, row-level `when`/`given`/executor callbacks, or function-valued scenario steps.

Before submitting a change, run:

```sh
bun run test:table
bun run typecheck
bun run test
```

## Pull requests

All repository changes should be developed on a branch and merged through a pull request. Do not push directly to `main`.

Pull request titles, descriptions, review replies, and linked issue references must be written in English. Keep the language clear and concise; code identifiers and command output may remain unchanged.

1. Branch from the latest `main` and keep the branch focused.
2. Explain the user-visible or architectural impact in English.
3. Add or update table-driven tests for domain, application, adapter, and HTTP behavior.
4. Add or update Storybook stories for meaningful view states.
5. Update the architecture or security documentation when behavior or trust boundaries change.
6. Run `bun run audit:public`, `bun run typecheck`, `bun run test`, and `bun run build` locally.
7. Do not include generated output, local databases, logs, credentials, or machine-specific paths.

The pull request should be ready for review before requesting merge. CI must pass, and author changes should be pushed as additional commits or a force-push to the same feature branch only; the target branch must not be updated directly.

## Agent plugins

New agent integrations should implement the plugin boundary in `packages/agents` and keep tool-specific behavior out of the domain package. Plugin tests must cover normal completion, input-waiting state, failure, cancellation, and cleanup.

## Commit and review guidance

Use a short imperative commit subject. Reviewers will prioritize correctness of terminal I/O, tmux ownership and restoration, credential boundaries, and recovery behavior over cosmetic changes.

If a change affects a security boundary, describe the threat model and the negative case in the pull request. Please do not publish a vulnerability in a normal issue.
