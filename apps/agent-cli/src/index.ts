#!/usr/bin/env bun
import { PairDevice } from "@mobile-agent/application";
import {
  AgentdPairingControlAdapter,
  PairCommand,
  PairCommandError,
  TerminalPairingPresenter,
  type PairCommandIo,
  type PairDeviceRuntime,
  type ParsedPairCommandOptions,
} from "@mobile-agent/cli-adapters";
import { AgentCommand, AgentCommandError } from "./agent-command.js";

const args = process.argv.slice(2);

async function createPairDeviceRuntime(
  options: ParsedPairCommandOptions,
  io: PairCommandIo,
): Promise<PairDeviceRuntime> {
  const control = await AgentdPairingControlAdapter.connect(options.controlSocket);
  return {
    useCase: new PairDevice(
      control,
      new TerminalPairingPresenter({ out: io.out, input: io.input }),
    ),
    close: () => control.close(),
  };
}

if (args[0] === "daemon") {
  try {
    const { startAgentd } = await import("@mobile-agent/agentd/daemon");
    startAgentd(args.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent daemon: ${message}\n`);
    process.exitCode = 2;
  }
} else if (args[0] === "pair") {
  const command = new PairCommand({
    env: process.env,
    io: { out: process.stdout, input: process.stdin },
    createRuntime: createPairDeviceRuntime,
  });
  try {
    process.exitCode = await command.execute(args.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${error instanceof PairCommandError ? "agent pair" : "agent pair: unexpected error"}: ${message}\n`);
    process.exitCode = error instanceof PairCommandError ? 2 : 1;
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
