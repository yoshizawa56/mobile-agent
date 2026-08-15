#!/usr/bin/env bun
import { PairDevice } from "@mobile-agent/application";
import {
  AgentdPairingControlAdapter,
  PairCommand,
  PairCommandError,
  TerminalPairingPresenter,
  type PairCommandIo,
  type PairDeviceRuntime,
  type ResolvedPairCommandOptions,
} from "@mobile-agent/cli-adapters";
import {
  createLogger,
  errorFields,
  errorMessage,
  type Logger,
  type LogLevel,
} from "@mobile-agent/logging";
import { AgentCommand, AgentCommandError } from "./agent-command.js";
import { parseGlobalOptions } from "./global-options.js";
import { resolvePairAgentdBaseUrl } from "./pair-route.js";

export { parseGlobalOptions } from "./global-options.js";
export type { ParsedGlobalOptions } from "./global-options.js";

async function createPairDeviceRuntime(
  options: ResolvedPairCommandOptions,
  io: PairCommandIo,
  logger?: Logger,
): Promise<PairDeviceRuntime> {
  const startedAt = Date.now();
  logger?.debug("pair.control_connecting");
  try {
    const control = await AgentdPairingControlAdapter.connect(options.controlSocket);
    logger?.debug("pair.control_connected", { durationMs: Date.now() - startedAt });
    return {
      useCase: new PairDevice(
        control,
        new TerminalPairingPresenter({ out: io.out, input: io.input }),
      ),
      close: () => control.close(),
    };
  } catch (error) {
    logger?.debug("pair.control_connection_failed", { durationMs: Date.now() - startedAt, ...errorFields(error) });
    throw error;
  }
}

const parsed = parseGlobalOptions(process.argv.slice(2));
const loggerLevel: LogLevel = parsed.verbose ? "debug" : "warn";
const logger = createLogger({
  service: "agent-cli",
  mode: "attached",
  level: loggerLevel,
  output: process.stderr,
  showStack: parsed.verbose,
});

await runCli(parsed.args, logger);

export async function runCli(args: string[], logger: Logger): Promise<void> {
  const commandName = args[0] ?? "help";
  const startedAt = Date.now();
  logger.debug("cli.command_started", { command: commandName, argumentCount: args.length });
  try {
    if (args[0] === "daemon") {
      const daemonStartedAt = Date.now();
      logger.debug("daemon.command_started", { argumentCount: args.length - 1 });
      try {
        const { runAgentdCommand } = await import("@mobile-agent/agentd/daemon");
        await runAgentdCommand(args.slice(1));
        logger.debug("daemon.command_finished", { durationMs: Date.now() - daemonStartedAt });
      } catch (error) {
        logger.debug("daemon.command_failed", { durationMs: Date.now() - daemonStartedAt, ...errorFields(error) });
        reportError(logger, "agent daemon", error, 2, false);
      }
    } else if (args[0] === "pair") {
      const pairStartedAt = Date.now();
      logger.debug("pair.command_started", { argumentCount: args.length - 1 });
      const command = new PairCommand({
        env: process.env,
        io: { out: process.stdout, input: process.stdin },
        resolveAgentdBaseUrl: resolvePairAgentdBaseUrl,
        createRuntime: (options, io) => createPairDeviceRuntime(options, io, logger),
      });
      try {
        process.exitCode = await command.execute(args.slice(1));
        logger.debug("pair.command_finished", { status: process.exitCode, durationMs: Date.now() - pairStartedAt });
      } catch (error) {
        logger.debug("pair.command_failed", { durationMs: Date.now() - pairStartedAt, ...errorFields(error) });
        reportError(logger, "agent pair", error, error instanceof PairCommandError ? 2 : 1, !(error instanceof PairCommandError));
      }
    } else if (args[0] === "serve") {
      try {
        const { runServeCommand } = await import("./serve-command.js");
        process.exitCode = await runServeCommand(args.slice(1), { logger });
      } catch (error) {
        reportError(logger, "agent serve", error, 2, false);
      }
    } else if (args[0] === "dev") {
      try {
        const { runDevCommand } = await import("./dev-command.js");
        process.exitCode = await runDevCommand(args.slice(1), process.env, {
          verbose: logger.isEnabled("debug"),
          logger,
        });
      } catch (error) {
        reportError(logger, "agent dev", error, 2, false);
      }
    } else {
      const command = new AgentCommand({ logger });

      try {
        const status = await command.execute(args);
        process.exitCode = status;
      } catch (error) {
        reportError(logger, "agent", error, error instanceof AgentCommandError ? 2 : 1, !(error instanceof AgentCommandError));
      } finally {
        command.close();
      }
    }
  } finally {
    logger.debug("cli.command_finished", { command: commandName, status: process.exitCode ?? 0, durationMs: Date.now() - startedAt });
    logger.close();
  }
}

function reportError(logger: Logger, prefix: string, error: unknown, status: number, unexpected: boolean): void {
  if (logger.isEnabled("debug")) {
    logger.debug("cli.command_failed", {
      prefix,
      status,
      unexpected,
      ...errorFields(error),
    });
  }
  const message = errorMessage(error);
  if (!unexpected || error instanceof AgentCommandError || error instanceof PairCommandError) {
    process.stderr.write(`${prefix}: ${message}\n`);
  } else {
    // Keep a terse, user-facing error even when diagnostics are disabled or
    // the diagnostic sink is unavailable. Verbose mode adds the structured
    // record, including its stack trace, as a supplement.
    process.stderr.write(`${prefix}: ${message}\n`);
    if (!logger.isEnabled("debug")) {
      process.exitCode = status;
      return;
    }
    logger.error("process.unhandled_error", {
      message: `unexpected error: ${message}`,
      ...errorFields(error),
    });
  }
  process.exitCode = status;
}
