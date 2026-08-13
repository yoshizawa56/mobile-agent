#!/usr/bin/env bun
import { runAgentdCommand } from "./daemon.js";

await runAgentdCommand(process.argv.slice(2));
