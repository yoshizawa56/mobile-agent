# Worktree hook examples

This directory contains setup and cleanup hook examples for `agent run ... --worktree`.

## Structure

- `generic/`: repository-independent helpers
  - `allocate-ports.sh`: deterministically assigns per-worktree ports from a workspace/name checksum
- `mobile-agent/`: a repository-specific example that combines the allocator with the mobile-agent workflow

SQLite seed copying and migration are kept directly in `mobile-agent/setup.sh` because they depend on mobile-agent's database paths and workflow. The base database is treated as a seed that is not updated concurrently and is copied as a single file with `cp` when present.

The setup hook performs these steps:

1. Copy an optional base SQLite database to `.local/agentd.sqlite` in the worktree.
2. Derive `AGENTD_PORT` and `VITE_DEV_PORT` from `AGENT_WORKSPACE` and `AGENT_NAME`, then save them to the worktree's `.env`.
3. Run `bun install --frozen-lockfile` when `MOBILE_AGENT_INSTALL_DEPENDENCIES=1`.
4. Run a SQLite migration only when `MOBILE_AGENT_MIGRATION_COMMAND` is set.

The cleanup hook does not release ports. Because ports are derived mechanically from the inputs, no registry cleanup is required when a managed worktree is removed. The database and `.env` remain inside the worktree and are removed with it.

## Using the hooks with mobile-agent

Hooks are registered as executable files that live on the host; they are not copied into the worktree. Grant them execute permission first:

```sh
chmod +x examples/hooks/generic/allocate-ports.sh
chmod +x examples/hooks/mobile-agent/*.sh
```

To use them directly from the CLI:

```sh
agent run codex --worktree review \
  --setup-hook "$PWD/examples/hooks/mobile-agent/setup.sh" \
  --cleanup-hook "$PWD/examples/hooks/mobile-agent/cleanup.sh"
```

When creating a worktree from the Web UI, set `SETUP SCRIPT PATH` and `CLEANUP SCRIPT PATH` during workspace registration to host-side absolute paths such as:

```text
/path/to/mobile-agent/examples/hooks/mobile-agent/setup.sh
/path/to/mobile-agent/examples/hooks/mobile-agent/cleanup.sh
```

To use this repository's default SQLite database as the seed:

```sh
MOBILE_AGENT_BASE_DB_FILE="$HOME/.local/state/mobile-agent/agentd.sqlite" \
MOBILE_AGENT_INSTALL_DEPENDENCIES=1 \
agent run codex --worktree review
```

If the base database does not exist, copying is skipped and agentd creates a new database in the worktree. Add `MOBILE_AGENT_REQUIRE_BASE_DB=1` to require the source database. Use `MOBILE_AGENT_DB_COPY_FORCE=1` only when an existing worktree database should be explicitly overwritten.

Ports are derived from the combination of `AGENT_WORKSPACE` and `AGENT_NAME`. The CLI does not allow duplicate names within the same workspace, so ordinary worktrees receive different slots. If the name is generated automatically, recreating a worktree may result in a different port assignment.

The current mobile-agent startup path prepares the database schema with `ensureSchema`, and this repository does not yet define a fixed migration command. Once migrations are introduced, configure one as follows:

```sh
MOBILE_AGENT_MIGRATION_COMMAND='bun run db:migrate' \
agent run codex --worktree review
```

`MOBILE_AGENT_MIGRATION_COMMAND` is executed with `sh -c` as a trusted local setting. The worktree database path is provided through `AGENTD_DB_FILE` and `AGENT_SQLITE_FILE`.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `MOBILE_AGENT_BASE_DB_FILE` | `AGENTD_DB_FILE` or `~/.local/state/mobile-agent/agentd.sqlite` | Source SQLite database |
| `MOBILE_AGENT_DB_PATH` | `.local/agentd.sqlite` | SQLite path inside the worktree |
| `MOBILE_AGENT_ENV_FILE` | `.env` | Environment file for ports and the database path |
| `MOBILE_AGENT_PORT_STRIDE` | `3` | Port increment per checksum slot |
| `MOBILE_AGENT_PORT_SLOT_COUNT` | `20000` | Number of checksum slots |
| `MOBILE_AGENT_INSTALL_DEPENDENCIES` | `0` | Install locked dependencies when set to `1` |
| `MOBILE_AGENT_MIGRATION_COMMAND` | Not set | Run this migration command when configured |

The allocator does not maintain a port registry or check whether another process has already bound a port. External processes and checksum-slot collisions cannot be prevented completely. If `bun run dev` reports a strict-port error, change `AGENTD_PORT` or `VITE_DEV_PORT` manually in `.env`. Existing port values are preserved when setup runs again.

## Reusing the allocator in other repositories

Only the port allocator is intended as a reusable component for other worktree-enabled repositories:

```sh
examples/hooks/generic/allocate-ports.sh allocate \
  --key "$AGENT_WORKSPACE:$AGENT_NAME" \
  --env-path "$AGENT_WORKTREE/.env" \
  --stride 3 \
  --slot-count 20000 \
  --port API_PORT=4317 \
  --port WEB_PORT=5227
```

When allocating multiple services, the `NAME=BASE` values passed to `--port` must use different lanes modulo `--stride`. For example, `4317` and `5227` use different lanes with `--stride 3`. Keep composed setup hooks idempotent, never write secrets to repository hooks or generated logs, and manage hook paths as host-side configuration.
