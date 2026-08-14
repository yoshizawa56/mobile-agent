#!/bin/sh
set -eu
umask 077

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
generic_directory=$script_directory/../generic

hook_log() {
  printf 'hook: %s\n' "$*"
}

hook_die() {
  printf 'hook: %s\n' "$*" >&2
  exit 1
}

if [ -z "${AGENT_WORKSPACE:-}" ] || [ ! -d "$AGENT_WORKSPACE" ]; then
  hook_die "AGENT_WORKSPACE must point to an existing directory"
fi
if [ -z "${AGENT_WORKTREE:-}" ] || [ ! -d "$AGENT_WORKTREE" ]; then
  hook_die "AGENT_WORKTREE must point to an existing directory"
fi

worktree_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$AGENT_WORKTREE" "$1" ;;
  esac
}

workspace_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$AGENT_WORKSPACE" "$1" ;;
  esac
}

env_file=${MOBILE_AGENT_ENV_FILE:-.env}
env_file=$(worktree_path "$env_file")
instance_path=${MOBILE_AGENT_INSTANCE_PATH:-.local}
instance_directory=$(worktree_path "$instance_path")
database_path=${MOBILE_AGENT_DB_PATH:-$instance_path/agentd.sqlite}
database_file=$(worktree_path "$database_path")
mkdir -p "$instance_directory"
chmod 700 "$instance_directory"
mkdir -p "$(dirname -- "$database_file")"

home_directory=${HOME:-}
default_instance_directory=${AGENTD_INSTANCE_DIR:-$home_directory/.local/state/mobile-agent}
default_database_file=$default_instance_directory/agentd.sqlite
base_database_file=${MOBILE_AGENT_BASE_DB_FILE:-${AGENTD_DB_FILE:-$default_database_file}}
case "$base_database_file" in
  ~) base_database_file=$home_directory ;;
  ~/*) base_database_file=$home_directory/${base_database_file#~/} ;;
  /*) ;;
  *) base_database_file=$(workspace_path "$base_database_file") ;;
esac

if [ "${MOBILE_AGENT_COPY_DB:-1}" = "1" ]; then
  if [ -f "$base_database_file" ]; then
    if [ -e "$database_file" ] && [ "${MOBILE_AGENT_DB_COPY_FORCE:-0}" != "1" ]; then
      hook_log "SQLite target already exists; keeping $database_file"
    else
      if [ "${MOBILE_AGENT_DB_COPY_FORCE:-0}" = "1" ]; then
        cp -fp "$base_database_file" "$database_file"
      else
        cp -p "$base_database_file" "$database_file"
      fi
      hook_log "copied SQLite seed to $database_file"
    fi
  elif [ "${MOBILE_AGENT_REQUIRE_BASE_DB:-0}" = "1" ]; then
    hook_die "base SQLite database does not exist: $base_database_file"
  else
    hook_log "base SQLite database not found; a new database will be created: $base_database_file"
  fi
else
  hook_log "SQLite copy disabled; using the worktree database path"
fi
if [ -e "$database_file" ]; then
  chmod 600 "$database_file"
fi

port_stride=${MOBILE_AGENT_PORT_STRIDE:-3}
port_slot_count=${MOBILE_AGENT_PORT_SLOT_COUNT:-20000}
if [ -z "${AGENT_WORKSPACE:-}" ] || [ -z "${AGENT_NAME:-}" ]; then
  hook_die "AGENT_WORKSPACE and AGENT_NAME are required for deterministic port allocation"
fi

"$generic_directory/allocate-ports.sh" allocate \
  --key "$AGENT_WORKSPACE:$AGENT_NAME" \
  --env-path "$env_file" \
  --stride "$port_stride" \
  --slot-count "$port_slot_count" \
  --port AGENTD_PORT=4317 \
  --port VITE_DEV_PORT=5227 \
  --set "AGENTD_INSTANCE_DIR=$instance_directory" \
  --set "AGENTD_DB_FILE=$database_file"

if [ "${MOBILE_AGENT_INSTALL_DEPENDENCIES:-0}" = "1" ]; then
  command -v bun >/dev/null 2>&1 || hook_die "MOBILE_AGENT_INSTALL_DEPENDENCIES=1 requires bun"
  hook_log "installing locked dependencies in the worktree"
  (cd "$AGENT_WORKTREE" && bun install --frozen-lockfile)
fi

if [ -n "${MOBILE_AGENT_MIGRATION_COMMAND:-}" ]; then
  hook_log "running configured SQLite migration"
  AGENTD_INSTANCE_DIR="$instance_directory" \
  AGENTD_DB_FILE="$database_file" \
  AGENT_SQLITE_FILE="$database_file" \
    sh -c "$MOBILE_AGENT_MIGRATION_COMMAND"
else
  hook_log "SQLite migration skipped; set MOBILE_AGENT_MIGRATION_COMMAND to enable one"
fi

hook_log "worktree environment is ready: $env_file"
