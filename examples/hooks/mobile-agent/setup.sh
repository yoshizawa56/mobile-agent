#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
generic_directory=$script_directory/../generic
. "$generic_directory/hook.sh"

agent_hook_require_workspace
agent_hook_require_worktree

env_file=${MOBILE_AGENT_ENV_FILE:-.env}
env_file=$(agent_hook_worktree_path "$env_file")
database_path=${MOBILE_AGENT_DB_PATH:-.local/agentd.sqlite}
database_file=$(agent_hook_worktree_path "$database_path")
mkdir -p "$(dirname -- "$database_file")"

home_directory=${HOME:-}
default_database_file=$home_directory/.local/state/mobile-agent/agentd.sqlite
base_database_file=${MOBILE_AGENT_BASE_DB_FILE:-${AGENTD_DB_FILE:-$default_database_file}}
case "$base_database_file" in
  ~) base_database_file=$home_directory ;;
  ~/*) base_database_file=$home_directory/${base_database_file#~/} ;;
  /*) ;;
  *) base_database_file=$(agent_hook_workspace_path "$base_database_file") ;;
esac

if [ "${MOBILE_AGENT_COPY_DB:-1}" = "1" ]; then
  if [ -f "$base_database_file" ]; then
    if [ "${MOBILE_AGENT_DB_COPY_FORCE:-0}" = "1" ]; then
      "$generic_directory/copy-sqlite.sh" \
        --source "$base_database_file" \
        --target "$database_file" \
        --force
    else
      "$generic_directory/copy-sqlite.sh" \
        --source "$base_database_file" \
        --target "$database_file"
    fi
  elif [ "${MOBILE_AGENT_REQUIRE_BASE_DB:-0}" = "1" ]; then
    agent_hook_die "base SQLite database does not exist: $base_database_file"
  else
    agent_hook_log "base SQLite database not found; a new database will be created: $base_database_file"
  fi
else
  agent_hook_log "SQLite copy disabled; using the worktree database path"
fi

port_stride=${MOBILE_AGENT_PORT_STRIDE:-3}
port_slot_count=${MOBILE_AGENT_PORT_SLOT_COUNT:-20000}
if [ -z "${AGENT_WORKSPACE:-}" ] || [ -z "${AGENT_NAME:-}" ]; then
  agent_hook_die "AGENT_WORKSPACE and AGENT_NAME are required for deterministic port allocation"
fi

"$generic_directory/allocate-ports.sh" allocate \
  --key "$AGENT_WORKSPACE:$AGENT_NAME" \
  --env-path "$env_file" \
  --stride "$port_stride" \
  --slot-count "$port_slot_count" \
  --port AGENTD_PORT=4317 \
  --port VITE_DEV_PORT=5227 \
  --set "AGENTD_DB_FILE=$database_file"

if [ "${MOBILE_AGENT_INSTALL_DEPENDENCIES:-0}" = "1" ]; then
  command -v bun >/dev/null 2>&1 || agent_hook_die "MOBILE_AGENT_INSTALL_DEPENDENCIES=1 requires bun"
  agent_hook_log "installing locked dependencies in the worktree"
  (cd "$AGENT_WORKTREE" && bun install --frozen-lockfile)
fi

if [ -n "${MOBILE_AGENT_MIGRATION_COMMAND:-}" ]; then
  AGENTD_DB_FILE="$database_file" \
  AGENT_SQLITE_FILE="$database_file" \
  AGENT_SQLITE_MIGRATION_COMMAND="$MOBILE_AGENT_MIGRATION_COMMAND" \
    "$generic_directory/run-sqlite-migration.sh"
else
  agent_hook_log "SQLite migration skipped; set MOBILE_AGENT_MIGRATION_COMMAND to enable one"
fi

agent_hook_log "worktree environment is ready: $env_file"
