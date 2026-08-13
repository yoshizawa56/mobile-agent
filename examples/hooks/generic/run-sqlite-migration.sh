#!/bin/sh
set -eu

database_file=${AGENTD_DB_FILE:-${AGENT_SQLITE_FILE:-}}
migration_command=${AGENT_SQLITE_MIGRATION_COMMAND:-}

if [ -z "$database_file" ]; then
  printf '%s\n' 'sqlite migration: AGENTD_DB_FILE or AGENT_SQLITE_FILE is required' >&2
  exit 1
fi
if [ -z "$migration_command" ]; then
  printf '%s\n' 'sqlite migration: AGENT_SQLITE_MIGRATION_COMMAND is required' >&2
  exit 1
fi

printf 'hook: running configured SQLite migration\n'
AGENTD_DB_FILE="$database_file" AGENT_SQLITE_FILE="$database_file" sh -c "$migration_command"
