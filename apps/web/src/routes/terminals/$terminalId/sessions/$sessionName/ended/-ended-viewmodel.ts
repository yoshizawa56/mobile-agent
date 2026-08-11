import { useMobileExperience } from "../../../../../../app/mobile-experience-context";
import type { ConnectionFlowViewModel } from "../../../../../../features/connection/connection-flow-viewmodel";

export type EndedViewModel = Omit<ConnectionFlowViewModel, "stage"> & { stage: "ended" };

export function useEndedViewModel(): EndedViewModel {
  const { connection } = useMobileExperience();
  return { ...connection, stage: "ended" };
}
