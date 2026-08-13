import { PairDevice } from "@mobile-agent/application";
import { AgentdPairingControlAdapter } from "./agentd-pairing-control-adapter.js";
import type { PairCommandIo, ParsedPairCommandOptions, PairDeviceRuntime } from "./pair-command.js";
import { TerminalPairingPresenter } from "./terminal-pairing-presenter.js";

/** Composition root for the production `agent pair` adapters. */
export async function createPairDeviceRuntime(
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
