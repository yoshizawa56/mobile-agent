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

`mise.toml` defines the default local ports and pins Bun, Node, and tmux. `bun run dev` starts the local stack as one process group: agentd listens on `127.0.0.1:4317`, and the Web app listens on `0.0.0.0:5227` with its `/api`, `/terminal`, and `/events` proxy pointed at that agentd instance. Override them only when needed:

```sh
AGENTD_PORT=4321 VITE_DEV_PORT=5228 bun run dev
```

`mise` pins Bun, Node.js, and tmux. Bun pins JavaScript dependencies through `bun.lock`.

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

To use a Serve connection, register the Serve URL from the web app's `settings` screen after exposing the host-side service:

```sh
bun run dev
mise run dev-serve
```

The browser's standard route is HTTPS/WSS through Tailscale Serve. SSH bastion routing is reserved as a future native adapter; the current web bundle does not include SSH or private-key management.

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
```

The unified `agent` binary includes the lifecycle CLI and the long-running `agentd` daemon. Build it with Bun's standalone executable target and run the daemon from the same file:

```sh
bun run build:agent
./dist/agent daemon start --port 4317
```

With `--worktree`, the CLI creates an `agent/<name>` branch and runs the registered workspace setup and cleanup scripts when present. Script paths are host-side personal settings, so they do not need to exist in the repository or in the worktree; each script runs with the created worktree as its current directory. A worktree with changes is removed only after confirmation. When Codex Managed Remote Control is used, the CLI also manages thread naming and archiving.

The default state database is `~/.local/state/mobile-agent/agentd.sqlite`. Override it with `AGENTD_DB_FILE`, `AGENT_WORKTREE_ROOT`, or `AGENT_HOOK_OUTPUT_DIR`. Lifecycle state and registered workspace hook paths are stored in SQLite; the legacy `.state` file is not read. Hook stdout logs are temporary execution artifacts separate from database state and are deleted after successful session cleanup.

When publishing inside a tailnet, keep agentd bound to localhost and expose port 4317 through Tailscale Serve and ACLs. The current MVP uses Tailscale Serve/ACL as its authentication boundary. Identity-header verification and per-device pairing tokens are planned security improvements.

For the MVP, the target window is resized to the mobile viewport and the target pane is zoomed only while a phone is connected. When desktop activity is detected, ownership returns to the desktop and its size and layout are restored. A fully independent twin session is a future extension.

Pane Board loads `/api/panes` through TanStack Query and opens the one-pane control room after selection. The `+` action in the terminal header also creates a pane. The form supports a new window, a right split, or a bottom split, and lets the user choose the source pane. The session overview can create shell, Codex, or Claude panes; worktree creation delegates to the host-side `agent run` command.
