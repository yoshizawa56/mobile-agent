import { useMobileExperience } from "../../app/mobile-experience-context";
import type { ConnectionFlowViewModel } from "../../features/connection/connection-flow-viewmodel";

export type TerminalsViewModel = Omit<ConnectionFlowViewModel, "stage"> & { stage: "terminals" };

export function useTerminalsViewModel(): TerminalsViewModel {
  const { connection } = useMobileExperience();
  return { ...connection, stage: "terminals" };
}
