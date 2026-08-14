#!/usr/bin/env bun
import { runAgentdCommand, startAgentd } from "./daemon.js";

const args = process.argv.slice(2);

// The package entrypoint is the foreground runtime used by the dev supervisor
// and service managers. The unified `agent daemon start` command is the
// user-facing lifecycle command and backgrounds this runtime through the
// daemon module.
if (
  args.length === 0
  || (
    !args.includes("-h")
    && !args.includes("--help")
    && (args[0] === "start" || args[0]?.startsWith("-"))
  )
) {
  await startAgentd(args);
} else {
  await runAgentdCommand(args[0] === "daemon" ? args.slice(1) : args);
}
