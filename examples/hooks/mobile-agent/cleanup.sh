#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
generic_directory=$script_directory/../generic
. "$generic_directory/hook.sh"

agent_hook_log "development ports are deterministic; no release is required"
