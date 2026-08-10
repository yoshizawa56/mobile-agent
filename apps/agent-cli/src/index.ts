#!/usr/bin/env node
import { AgentCommand, AgentCommandError } from "./agent-command.js";

const command = new AgentCommand();

try {
  const status = await command.execute(process.argv.slice(2));
  process.exitCode = status;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${error instanceof AgentCommandError ? "agent" : "agent: unexpected error"}: ${message}\n`);
  process.exitCode = error instanceof AgentCommandError ? 2 : 1;
} finally {
  command.close();
}
