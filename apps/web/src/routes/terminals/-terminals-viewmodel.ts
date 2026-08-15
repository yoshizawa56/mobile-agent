import { useMobileExperience } from "../../app/mobile-experience-context";
import type { ConnectionSettingsViewModel } from "../../features/connection/connection-settings-viewmodel";
import type { ConnectionFlowViewModel } from "../../features/connection/connection-flow-viewmodel";

export type TerminalsViewModel = Omit<ConnectionFlowViewModel, "stage"> & { stage: "terminals"; connectionSettings: ConnectionSettingsViewModel };

export function useTerminalsViewModel(): TerminalsViewModel {
  const { connection, connectionSettings } = useMobileExperience();
  return { ...connection, connectionSettings, stage: "terminals" };
}
