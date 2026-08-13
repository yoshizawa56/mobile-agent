#!/bin/sh
set -eu

# Shared, intentionally small helpers for workspace setup and cleanup hooks.
# Source this file from a hook and keep repository-specific policy in that
# hook's directory.

agent_hook_log() {
  printf 'hook: %s\n' "$*"
}

agent_hook_die() {
  printf 'hook: %s\n' "$*" >&2
  exit 1
}

agent_hook_require_worktree() {
  if [ -z "${AGENT_WORKTREE:-}" ]; then
    agent_hook_die "this hook requires AGENT_WORKTREE; run it with --worktree"
  fi
  if [ ! -d "$AGENT_WORKTREE" ]; then
    agent_hook_die "worktree directory does not exist: $AGENT_WORKTREE"
  fi
}

agent_hook_require_workspace() {
  if [ -z "${AGENT_WORKSPACE:-}" ]; then
    agent_hook_die "AGENT_WORKSPACE is required"
  fi
  if [ ! -d "$AGENT_WORKSPACE" ]; then
    agent_hook_die "workspace directory does not exist: $AGENT_WORKSPACE"
  fi
}

agent_hook_workspace_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$AGENT_WORKSPACE" "$1" ;;
  esac
}

agent_hook_worktree_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$AGENT_WORKTREE" "$1" ;;
  esac
}
