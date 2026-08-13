#!/usr/bin/env bun
import { AgentCommand, AgentCommandError } from "./agent-command.js";

const args = process.argv.slice(2);

if (args[0] === "daemon") {
  try {
    const { runAgentdCommand } = await import("@mobile-agent/agentd/daemon");
    await runAgentdCommand(args.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent daemon: ${message}\n`);
    process.exitCode = 2;
  }
} else if (args[0] === "serve") {
  try {
    const { runServeCommand } = await import("./serve-command.js");
    process.exitCode = await runServeCommand(args.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent serve: ${message}\n`);
    process.exitCode = 2;
  }
} else if (args[0] === "dev") {
  try {
    const { runDevCommand } = await import("./dev-command.js");
    process.exitCode = await runDevCommand(args.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent dev: ${message}\n`);
    process.exitCode = 2;
  }
} else {
  const command = new AgentCommand();

  try {
    const status = await command.execute(args);
    process.exitCode = status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${error instanceof AgentCommandError ? "agent" : "agent: unexpected error"}: ${message}\n`);
    process.exitCode = error instanceof AgentCommandError ? 2 : 1;
  } finally {
    command.close();
  }
}
