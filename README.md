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

`mise.toml` pins Bun, Node, and tmux. `bun run dev` uses an explicit local profile derived from the current linked worktree: agentd, the Web app, and SQLite each get worktree-specific runtime state and the agentd process is never shared across different worktrees. The tmux socket and sessions are intentionally shared with the normal user tmux server. The launcher prints the selected agentd and Web URLs. It starts a fresh agentd and Web process for the current profile; an occupied port is treated as an error rather than adopting another process. Services started by the command run in detached process groups, so Ctrl-C stops their descendants without leaving orphaned Bun or Vite processes.

Before printing `ready`, the command checks agentd's `/health`, the web HTML shell, the web `/api/capabilities` proxy, and WebSocket upgrades for both `/terminal` and `/events`. If an owned child exits, `bun run dev` reports the exit and stops the remaining owned process groups; it does not automatically restart a failed service. Readiness and failure output includes the endpoint, process owner, and a recovery command. If a port is occupied, inspect it with the command shown in the log or choose explicit free ports:

```sh
AGENTD_PORT=4321 VITE_DEV_PORT=5228 bun run dev
```

`mise` pins Bun, Node.js, and tmux. Bun pins JavaScript dependencies through `bun.lock`.

The dev profile is safe to start from multiple linked worktrees. Every worktree gets its own `AGENT_WORKTREE_ID`, agentd HTTP port, Web port, SQLite file, and agentd process. All of those agentd processes still use the same tmux socket and can reference the same tmux sessions. If a derived port is occupied, set `AGENTD_PORT` or `VITE_DEV_PORT` to a free port; the dev supervisor never attaches to an existing agentd or Web process.

When adding or updating dependencies, verify the latest stable registry release and the project's official release information first. Use `bun run deps:check` for the repository's dependency checks. Alpha, beta, and release-candidate versions are not used by default.

agentd exposes an HTTP API at `http://127.0.0.1:4317`, a terminal WebSocket at `ws://127.0.0.1:4317/terminal`, and an event WebSocket at `ws://127.0.0.1:4317/events`. Registered workspaces are listed through `GET /api/workspaces`; host directories can be browsed through `GET /api/workspace-directories` and registered with `POST /api/workspaces`, including optional host-side setup and cleanup script paths. Session and pane creation sends stable workspace IDs, which agentd resolves under its allowed-root policy. Session lists, pane lists, session creation, and pane creation use HTTP. Terminal input/output and resize use the terminal WebSocket. The event WebSocket sends only session invalidation notifications; clients refetch changed data through HTTP. agentd is the host-side control-plane daemon for tmux, agent plugins, and SQLite.

The HTTP API is built from a dependency-injected Hono app returned by `createAgentdApp(deps)`. Its type, `ReturnType<typeof createAgentdApp>`, is shared with the TypeScript client as `AgentdApp`. Tailscale Serve and SSH port forwarding are connection routes to the same agentd instance; the web client does not need to know which route established the connection.

The browser build stores only a full Tailscale Serve URL as its connection setting. A custom external port belongs in that URL, for example `https://workstation.tailnet.ts.net:8449`; the internal `AGENTD_PORT` is not a mobile setting. It does not store private keys or passwords. Storybook runs with mock data, while the regular Vite development server connects to agentd through the supervisor-managed proxy.

```sh
bun run --filter @mobile-agent/web dev
# Use this mode to inspect the UI without agentd.
VITE_AGENTD_MOCK_MODE=true bun run --filter @mobile-agent/web dev
```

The web dev server uses strict port binding. If `5227` is already occupied by another application, Vite exits instead of silently moving to a different port and showing the wrong app. Choose an explicit free port when needed, for example `VITE_DEV_PORT=5228 bun run --filter @mobile-agent/web dev`.

Tailscale Serve is opt-in. Start the local stack first, then in a second terminal expose the web port through an already installed and configured Tailscale CLI:

```sh
bun run dev
mise run dev-serve
```

`dev-serve` maps the local web server to HTTPS port `8449` by default and never installs or configures Tailscale. Override the ports when needed with `TAILSCALE_DEV_PORT` and `VITE_DEV_PORT`. After exposing the host-side service, register its full Serve URL from the web app's `settings` screen. The browser's standard route is HTTPS/WSS through Tailscale Serve. SSH bastion routing is reserved as a future native adapter; the current web bundle does not include SSH or private-key management.

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
agent daemon start --host 127.0.0.1 --port 4317
agent daemon status
agent daemon restart
```

The unified `agent` binary includes the lifecycle CLI and the long-running `agentd` daemon. Build it with Bun's standalone executable target and run the daemon from the same file:

```sh
bun run build:agent
./dist/agent daemon start --port 4317
```

With `--worktree`, the CLI creates an `agent/<name>` branch and runs the registered workspace setup and cleanup scripts when present. Script paths are host-side personal settings, so they do not need to exist in the repository or in the worktree; each script runs with the created worktree as its current directory. A worktree with changes is removed only after confirmation. When Codex Managed Remote Control is used, the CLI also manages thread naming and archiving.

`build:agent` builds the agent CLI's workspace dependencies before compiling the standalone executable, so it also works from a clean checkout. For local development, start the stack with `bun dev` in each linked worktree and use `agent_main` when you need the latest CLI from `origin/main`.

### Keeping both agentd processes running

`agent daemon start` is intentionally a foreground process so launchd, systemd, or another process supervisor can own its lifecycle. Run one service for the stable profile and one for the fixed `agent_main` profile; they must use different SQLite files and HTTP ports while leaving `AGENTD_TMUX_SOCKET` unset so both continue to see the same tmux server.

```sh
# stable service command
agent daemon start --host 127.0.0.1 --port 4317

# main service command
AGENT_MAIN_DIR="$HOME/.local/share/mobile-agent/agent-main" agent_main daemon start --host 127.0.0.1 --port 6317
```

The daemon lifecycle commands use a profile-specific PID file (by default next to the SQLite file):

```sh
agent daemon status
agent_main daemon status
agent daemon restart
agent_main daemon restart
agent daemon stop
```

`restart` stops the recorded healthy daemon and starts the current command path. If launchd or systemd restarts the service first, it reuses that service-managed process instead of starting a duplicate. Therefore updating either runtime is explicit and deterministic:

```sh
# update and restart main
git -C "$HOME/.local/share/mobile-agent/agent-main" fetch origin main
git -C "$HOME/.local/share/mobile-agent/agent-main" checkout --detach origin/main
agent_main daemon restart

# install and restart stable
bun run agent:install
agent daemon restart
```

There is no live code replacement inside an already-running agentd process. The restart is required so the process loads the new source or standalone binary. A service manager with `KeepAlive`/`Restart=on-failure` should be used for boot-time startup and crash recovery; the explicit `daemon restart` command is also sufficient when updates are performed manually.

### Releases

Pushing a semantic version tag such as `v0.0.1-beta.1` starts the release workflow. It runs the repository checks, builds standalone executables for Linux x64, Linux ARM64, macOS ARM64, and macOS x64, and attaches the binaries and `SHA256SUMS.txt` to the GitHub Release.

GitHub generates the Release notes from merged pull requests, contributors, and the full changelog link. Keep pull request titles user-facing so the generated notes remain useful. Tags containing a prerelease suffix such as `-beta.1` are published as prereleases.

The default state database is `~/.local/state/mobile-agent/agentd.sqlite`. Override it with `AGENTD_DB_FILE`, `AGENT_WORKTREE_ROOT`, or `AGENT_HOOK_OUTPUT_DIR`. Lifecycle state and registered workspace hook paths are stored in SQLite; the legacy `.state` file is not read. Hook stdout logs are temporary execution artifacts separate from database state and are deleted after successful session cleanup.

The repository provides two explicit command channels. The unqualified `agent` command is reserved for the production standalone binary; it never builds the current checkout or silently falls back to `origin/main`. `agent_main` is a thin launcher for one fixed origin/main checkout. It runs `apps/agent-cli/src/index.ts` directly with Bun, does not fetch on invocation, does not create a new worktree, and does not compile a second standalone binary. The checkout is `AGENT_MAIN_DIR` or `~/.local/share/mobile-agent/agent-main`. Development servers are started directly with `bun dev` from each linked worktree; there is no separate current-worktree CLI launcher.

Install the latest stable release and expose the latest-main launcher through PATH:

```sh
bun run agent:install
ln -sfn "$PWD/bin/agent_main" "$HOME/.local/bin/agent_main"
agent --help
```

`bun run agent:install` downloads the latest stable GitHub Release for the current OS/architecture, verifies `SHA256SUMS.txt`, stores the binary at `~/.local/libexec/mobile-agent/agent`, and updates `~/.local/bin/agent` to point directly to that binary. To set up the fixed `agent_main` checkout once, use a normal linked worktree and install its dependencies:

```sh
git worktree add --detach "$HOME/.local/share/mobile-agent/agent-main" origin/main
(cd "$HOME/.local/share/mobile-agent/agent-main" && bun install --frozen-lockfile)
```

Override the checkout with `AGENT_MAIN_DIR`; override the state directory with `AGENT_MAIN_STATE_ROOT`. The repository-local `bin/agent_main` launcher can be exposed through PATH as shown above.

The command choice is therefore explicit:

```sh
agent run codex             # stable production binary
agent_main run codex        # fixed origin/main checkout executed by Bun
```

`agent_main` intentionally does not update the checkout during command execution. Update it explicitly when you want a newer `origin/main`, then the next invocation uses that code:

```sh
git -C "$HOME/.local/share/mobile-agent/agent-main" fetch origin main
git -C "$HOME/.local/share/mobile-agent/agent-main" checkout --detach origin/main
```

The stable `agent` command uses the release profile by default, while `agent_main` uses the isolated `main` profile with a separate SQLite file and HTTP port. Both continue to use the default tmux socket, so they can see the same tmux sessions without sharing an agentd process. Override the main profile with `AGENTD_DB_FILE` or `AGENTD_PORT` when needed.

With `--worktree`, the CLI creates an `agent/<name>` branch in the release/default profile and an `agent/<worktree-id>/<name>` branch in the local dev profile. The latter avoids Git branch collisions when the same session name is used from multiple linked worktrees. A worktree with changes is removed only after confirmation. When Codex Managed Remote Control is used, the CLI also manages thread naming and archiving.

The default release state database is `~/.local/state/mobile-agent/agentd.sqlite`; the local dev profile uses `~/.local/state/mobile-agent/worktrees/<worktree-id>/agentd.sqlite`; `agent_main` uses `~/.local/state/mobile-agent/agent-main/agentd.sqlite`. Override it with `AGENTD_DB_FILE`. The local and main profiles also separate hook output under their respective state directories. Other overrides are `AGENTD_MIGRATIONS_DIR`, `AGENT_PROJECTS_ROOT`, `AGENT_WORKTREE_ROOT`, and `AGENT_HOOK_OUTPUT_DIR`. Lifecycle state is stored only in SQLite; the legacy `.state` file is not read. Hook stdout logs are temporary execution artifacts separate from database state and are deleted after successful session cleanup.

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
