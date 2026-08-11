import { useMobileExperience } from "../../../../../../app/mobile-experience-context";
import type { ConnectionFlowViewModel } from "../../../../../../features/connection/connection-flow-viewmodel";

export type ConnectingViewModel = Omit<ConnectionFlowViewModel, "stage"> & { stage: "connecting" };

export function useConnectingViewModel(): ConnectingViewModel {
  const { connection } = useMobileExperience();
  return { ...connection, stage: "connecting" };
}
