# Mobile Agent

Mobile Agent is a monorepo for operating tmux-hosted agents and shells one pane at a time from an iPhone.

> **Pre-alpha:** This project is in the early stages of public development. Configuration, APIs, and data formats may change. See [SECURITY.md](SECURITY.md) for the current security boundaries and limitations.

[![CI](https://github.com/yoshizawa56/mobile-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yoshizawa56/mobile-agent/actions/workflows/ci.yml)

## OSS project files

- [LICENSE](LICENSE): MIT License
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, testing, and pull request rules
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): community standards
- [SECURITY.md](SECURITY.md): vulnerability reporting and current security boundaries

Before publishing a branch or pull request, audit tracked and non-ignored files with:

```sh
bun run audit:public
```

## Smallest vertical slice under development

- `apps/agentd`: attaches to the target tmux pane with `active-pane`, manages the viewport lease, and relays terminal bytes over WebSocket
- `apps/agentd`: a long-running Hono control-plane daemon
- `apps/agent-cli`: the `agent` CLI, with agent lifecycle state managed by SQLite
- `apps/web`: renders one pane with xterm.js and sends terminal size changes to agentd
- `packages/agentd-client`: the TypeScript client for Hono RPC, Zod validation, and the agentd terminal WebSocket
- `packages/cli-adapters`: CLI-side infrastructure adapters and composition factories
- `packages/domain`: Pane/Run state and agent waiting-state rules
- `packages/application`: use cases and ports shared by the CLI and WebSocket adapters
- `packages/persistence`: Drizzle + SQLite persistence for panes, runs, audits, registered workspaces, and agent sessions
- `packages/agents`: the AgentPlugin API and shell plugin
- `packages/protocol`: Zod definitions for WebSocket and Pane Board DTOs

```sh
mise install
bun install --frozen-lockfile
bun run dev
```

`mise.toml` pins Bun, Node, and tmux. `bun run dev` uses an explicit local profile derived from the current linked worktree: agentd, the Web app, and the agentd instance directory each get worktree-specific runtime state and the agentd process is never shared across different worktrees. The tmux socket and sessions are intentionally shared with the normal user tmux server. The launcher prints the selected agentd and Web URLs. It starts a fresh agentd and Web process for the current profile; an occupied port is treated as an error rather than adopting another process. Services started by the command run in detached process groups, so Ctrl-C stops their descendants without leaving orphaned Bun or Vite processes.

Before printing `ready`, the command checks agentd's `/health`, the web HTML shell, the web `/api/capabilities` proxy, and WebSocket upgrades for both `/terminal` and `/events`. If an owned child exits, `bun run dev` reports the exit and stops the remaining owned process groups; it does not automatically restart a failed service. Readiness and failure output includes the endpoint, process owner, and a recovery command. If a port is occupied, inspect it with the command shown in the log or choose explicit free ports:

```sh
AGENTD_PORT=4321 VITE_DEV_PORT=5228 bun run dev
```

`mise` pins Bun, Node.js, and tmux. Bun pins JavaScript dependencies through `bun.lock`.

The dev profile is safe to start from multiple linked worktrees. Every worktree gets its own `AGENT_WORKTREE_ID`, agentd HTTP port, Web port, SQLite file, and agentd process. All of those agentd processes still use the same tmux socket and can reference the same tmux sessions. If a derived port is occupied, set `AGENTD_PORT` or `VITE_DEV_PORT` to a free port; the dev supervisor never attaches to an existing agentd or Web process.

When adding or updating dependencies, verify the latest stable registry release and the project's official release information first. Use `bun run deps:check` for the repository's dependency checks. Alpha, beta, and release-candidate versions are not used by default.

agentd exposes an HTTP API at `http://127.0.0.1:4317`, a terminal WebSocket at `ws://127.0.0.1:4317/terminal`, and an event WebSocket at `ws://127.0.0.1:4317/events`. Registered workspaces are listed through `GET /api/workspaces`; host directories can be browsed through `GET /api/workspace-directories` and registered with `POST /api/workspaces`, including optional host-side setup and cleanup script paths and one worktree copy pattern per line. Session and pane creation sends stable workspace IDs, which agentd resolves under its allowed-root policy. Session lists, pane lists, session creation, and pane creation use HTTP. Terminal input/output and resize use the terminal WebSocket. The event WebSocket sends only session invalidation notifications; clients refetch changed data through HTTP. agentd is the host-side control-plane daemon for tmux, agent plugins, and SQLite.

The HTTP API is built from a dependency-injected Hono app returned by `createAgentdApp(deps)`. Its type, `ReturnType<typeof createAgentdApp>`, is shared with the TypeScript client as `AgentdApp`. Tailscale Serve and SSH port forwarding are connection routes to the same agentd instance; the web client does not need to know which route established the connection.

The browser build stores only a full Tailscale Serve URL as its connection setting. A custom external port belongs in that URL, for example `https://workstation.tailnet.ts.net:8449`; the internal `AGENTD_PORT` is not a mobile setting. It does not store private keys or passwords. Storybook runs with mock data, while the regular Vite development server connects to agentd through the supervisor-managed proxy.

```sh
bun run --filter @mobile-agent/web dev
# Use this mode to inspect the UI without agentd.
VITE_AGENTD_MOCK_MODE=true bun run --filter @mobile-agent/web dev
```

The web dev server uses strict port binding. If `5227` is already occupied by another application, Vite exits instead of silently moving to a different port and showing the wrong app. Choose an explicit free port when needed, for example `VITE_DEV_PORT=5228 bun run --filter @mobile-agent/web dev`.

Tailscale Serve is opt-in. The CLI treats Serve as a persistent Tailscale configuration: it starts or verifies the local target, upserts the fixed external port, prints the URL, and exits its Serve setup step. It does not own, monitor, or remove the Serve route afterward.

```sh
agent dev serve tailscale
```

`agent dev serve tailscale` starts the current worktree's agentd and Web, then maps the Web server to HTTPS port `443` by default. The Web server proxies `/api`, `/terminal`, and `/events` to that worktree's agentd. The next worktree that runs the command retargets the same fixed Serve endpoint. Override the external and local ports with `AGENT_DEV_SERVE_PORT`, `AGENTD_PORT`, and `VITE_DEV_PORT`.

For a release or staging agentd that does not need an external Web server, use the agentd-only command:

```sh
agent serve tailscale
```

This uses `AGENT_SERVE_PORT` (default `8444`) for the external HTTPS port and `AGENTD_PORT` for the local agentd port. A staging main checkout can set `AGENT_SERVE_PORT=8443`; a release binary can use `AGENT_SERVE_PORT=8444`, or `443` when it runs on a separate Tailscale node. Neither command restores an earlier worktree or removes the route when the local process exits. To inspect the provider's current configuration, use `tailscale serve status`.

After exposing the host-side service, register the full Serve URL from the web app's `settings` screen. The browser's standard route is HTTPS/WSS through Tailscale Serve. SSH bastion routing is reserved as a future native adapter; the current web bundle does not include SSH or private-key management.

To proxy Vite requests to another agentd instance, set `VITE_AGENTD_PROXY_TARGET`. After a native bridge creates an SSH port forward, pass its localhost HTTP and WebSocket URLs to the same `AgentdConnection` abstraction.

Storybook can be used to inspect individual screens. It listens on `0.0.0.0:6006`; after configuring Tailscale Serve, open it at `https://<this-Mac's-tailnet-hostname>:8448/`.

```sh
bun run --filter @mobile-agent/web storybook
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8448 6006
```

To inspect the real app from the tailnet, add the tailnet hostname to Vite's host allow-list and expose a separate port. The existing Storybook Serve configuration can remain in place.

```sh
VITE_AGENTD_PROXY_TARGET=http://127.0.0.1:4318 \
VITE_ALLOWED_HOSTS=<tailnet-hostname> \
VITE_DEV_HOST=0.0.0.0 VITE_DEV_PORT=5227 \
bun run --filter @mobile-agent/web dev
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8449 5227
```

The web app uses clean client-side routes. Use Vite's dev or preview server when exposing it through Tailscale Serve; both are configured as SPA servers and fall back to `index.html` for a deep-link reload. Do not serve `apps/web/dist` with a raw static file server unless that server is configured with the same fallback.

```sh
bun run --filter @mobile-agent/web build
bun run --filter @mobile-agent/web preview --host 0.0.0.0 --port 4173
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8449 4173
```

## Worktree hook examples

Reusable setup / cleanup hook examples are available in [`examples/hooks`](examples/hooks/README.md). The generic pieces cover SQLite snapshots, deterministic per-worktree development port allocation, env-file updates, and optional SQLite migration commands. The `mobile-agent` example combines them for isolated worktree development.

## Agent CLI

The lifecycle previously implemented by `bin/agent` in dotfiles has been migrated to TypeScript in this repository. SQLite is the canonical state source; the legacy `.state` format is intentionally not read.

```sh
agent run codex --worktree review
agent run claude --no-worktree -n quick-fix
agent resume review
agent list --json
agent list --global
agent cleanup review --force
agent doctor --verbose
agent tmux new-session -s project -c ~/work/project
agent tmux new-session -s project -c ~/work/project --detached
agent daemon start --host 127.0.0.1 --port 4317
agent daemon status
agent daemon restart
```

### Logging

`-v` / `--verbose` controls detailed diagnostics written to the attached terminal. It does not change a background `agentd` process. Configure the daemon with `--log-level LEVEL` and `--log-file PATH`; background logs are JSONL and default to `~/.local/state/mobile-agent/agentd.log` with bounded rotation. `AGENT_LOG_LEVEL` and `AGENT_LOG_FILE` provide the corresponding `agentd` environment defaults.

The unified `agent` binary includes the lifecycle CLI and the long-running `agentd` daemon. Build it with Bun's standalone executable target and run the daemon from the same file:

```sh
bun run build:agent
./dist/agent daemon start --port 4317
```

With `--worktree`, the CLI creates an `agent/<name>` branch, copies configured unmanaged files such as `.env` into the same relative paths, and then runs the registered workspace setup script when present. Copy patterns are relative and support `*` and `**`; missing matches are warnings. Cleanup scripts run before the worktree is removed. Script paths are host-side personal settings, so they do not need to exist in the repository or in the worktree; each script runs with the created worktree as its current directory. A worktree with changes is removed only after confirmation. When Codex Managed Remote Control is used, the CLI also manages thread naming and archiving.

`agent tmux new-session` creates a managed tmux session. Its initial pane and later panes created without an explicit command start through `agent shell`, so a desktop-created shell and an app-created pane share the same wrapper context. Running `agent run codex` or `agent run claude` from that shell preserves the parent shell/run metadata for agentd. Existing tmux sessions and panes created with an explicit command remain outside the wrapper, but an agent started or resumed from such an unmanaged shell is still adopted into SQLite while it runs. When the agent exits, the pane remains available as a shell for the next command.

`build:agent` compiles the agent CLI directly from the workspace's TypeScript sources, so it also works from a clean checkout. `agent serve tailscale` is available in the standalone binary and publishes only agentd. `agent dev serve tailscale` is a source-checkout command: it delegates to the current checkout's Bun development supervisor, which is why it includes the Web server. For source-based local development, use `agent dev` or `agent dev serve tailscale`; `bun dev` remains a compatible direct entrypoint.

### Running multiple agentd instances

`agent daemon start` starts agentd in a detached process, waits for its health endpoint, and returns to the shell. Use `agent daemon status`, `agent daemon restart`, and `agent daemon stop` for its lifecycle. If launchd, systemd, or another process supervisor needs to own the foreground process directly, use `agent daemon start --foreground` (or the `apps/agentd` package entrypoint). When multiple agentd processes share the normal tmux server, give every process a distinct `AGENTD_INSTANCE_DIR`, HTTP port, and `AGENT_WORKTREE_ID`. The instance directory contains the SQLite database, hook output, PID file, and control socket. The tmux socket itself should remain shared unless a separate tmux server is explicitly required.

```sh
# profile-a.env and profile-b.env are local files and are not committed.
# Each file contains a unique AGENTD_INSTANCE_DIR, AGENTD_PORT, and
# AGENT_WORKTREE_ID; leave AGENTD_TMUX_SOCKET unset to share tmux.
set -a; . ./profile-a.env; set +a
agent daemon start
```

The daemon lifecycle commands use the same profile environment:

```sh
set -a; . ./profile-a.env; set +a
agent daemon status
agent daemon restart
agent daemon stop
```

`restart` stops the recorded healthy daemon and starts the current command path. If launchd or systemd restarts the service first, it reuses that service-managed process instead of starting a duplicate. There is no live code replacement inside an already-running agentd process, so restart is required after updating the runtime. A service manager with `KeepAlive`/`Restart=on-failure` should invoke the explicit `--foreground` mode for boot-time startup and crash recovery.

### Releases

Push a preflight tag such as `preflight/v0.0.1` at the candidate commit to
run the repository checks and upload the signed iOS build to TestFlight. This
does not create a GitHub Release. After validating that build, push the
matching semantic version tag, such as `v0.0.1`, at the same commit. The final
tag rebuilds the commit, builds standalone executables for Linux x64, Linux
ARM64, macOS ARM64, and macOS x64, and attaches the binaries and
`SHA256SUMS.txt` to the GitHub Release.

GitHub generates the Release notes from merged pull requests, contributors, and the full changelog link. Keep pull request titles user-facing so the generated notes remain useful. Tags containing a prerelease suffix such as `-beta.1` are published as prereleases.

The unqualified `agent` command is reserved for the production standalone binary. It never builds the current checkout or silently selects another source tree. `agent dev` only delegates to a source checkout when one is available; the standalone binary itself does not bundle Web or Vite.

Install the latest stable release and expose the production command through PATH:

```sh
bun run agent:install
agent --help
```

`bun run agent:install` downloads the latest stable GitHub Release for the current OS/architecture, verifies `SHA256SUMS.txt`, stores the binary at `~/.local/libexec/mobile-agent/agent`, and updates `~/.local/bin/agent` to point directly to that binary. Override the install paths with `AGENT_INSTALL_DIR` and `AGENT_BIN_DIR` when needed.

The default agentd instance directory is `~/.local/state/mobile-agent`; it contains `agentd.sqlite`, `hooks/`, `agentd.sqlite.pid`, and the legacy `agentd.sqlite.control.sock`. Set `AGENTD_INSTANCE_DIR` to isolate another instance or worktree profile; configured instance directories use the shorter `agentd.sock` control socket. `AGENTD_DB_FILE`, `AGENT_HOOK_OUTPUT_DIR`, `AGENTD_PID_FILE`, and `AGENTD_CONTROL_SOCKET` remain available as legacy or service-manager overrides, but are not needed for normal use. Other overrides are `AGENTD_MIGRATIONS_DIR` and `AGENT_WORKTREE_ROOT`. Lifecycle state, registered workspace hook paths, and worktree copy patterns are stored only in SQLite; the legacy `.state` file is not read. Hook stdout logs are temporary execution artifacts separate from database state and are deleted after successful session cleanup.

With `--worktree`, the CLI creates an `agent/<name>` branch by default. When `AGENT_WORKTREE_ID` is set, it uses an isolated worktree directory and `agent/<worktree-id>/<name>` branch namespace, which avoids collisions when the same session name is used from multiple linked worktrees.

`AGENTD_TMUX_SOCKET` is not automatically changed by the dev profile. Leaving it unset means that release and dev processes use the same default tmux server; setting it explicitly changes the tmux server and is an advanced isolation choice, not part of normal worktree separation. Each agentd has its own pane database and HTTP endpoint. Its tmux hooks use a process-specific registration and its pane metadata uses a worktree-specific namespace, so multiple agentd processes can observe the same tmux sessions without overwriting each other's records. Viewport control remains inherently global to a tmux window; two mobile clients should not try to control the same window concurrently.

### Database migrations

The runtime applies Drizzle migrations whenever `createAgentDatabase()` opens SQLite. Drizzle records applied migration hashes and timestamps in `__drizzle_migrations`, checks the generated journal, and applies only pending SQL in a transaction before repositories are constructed. The standalone `agent` build copies the `packages/persistence/drizzle` directory next to the executable and bundles the generated migration files as a fallback, so the same flow works without a source checkout or adjacent migration files.

When changing `packages/persistence/src/schema.ts`, generate and review the migration, then commit the SQL and metadata files:

```sh
bun run --filter @mobile-agent/persistence db:generate
bun run --filter @mobile-agent/persistence db:check
```

`db:generate` also refreshes the generated embedded migration module; commit the SQL, journal, and generated module together. Normal `agent` and `agentd` startup applies pending migrations automatically. `db:migrate` remains available for an explicit administrative migration run. Databases created by the previous `CREATE TABLE IF NOT EXISTS` implementation are detected once and baseline-registered as the initial migration without dropping their data; a partial legacy schema fails closed instead of being guessed at.

When publishing inside a tailnet, keep agentd bound to localhost and expose port 4317 through Tailscale Serve and ACLs. The current MVP uses Tailscale Serve/ACL as its authentication boundary. Identity-header verification and per-device pairing tokens are planned security improvements.

For the MVP, the target window is resized to the mobile viewport and the target pane is zoomed only while a phone is connected. When desktop activity is detected, ownership returns to the desktop and its size and layout are restored. A fully independent twin session is a future extension.

Pane Board loads `/api/panes` through TanStack Query and opens the one-pane control room after selection. The `+` action in the terminal header also creates a pane. The form supports a new window, a right split, or a bottom split, and lets the user choose the source pane. The session overview can create shell, Codex, or Claude panes; worktree creation delegates to the host-side `agent run` command.
