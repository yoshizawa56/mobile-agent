import { useMobileExperience } from "../../../../../../app/mobile-experience-context";
import type { ConnectionFlowViewModel } from "../../../../../../features/connection/connection-flow-viewmodel";

export type DisconnectedViewModel = Omit<ConnectionFlowViewModel, "stage"> & { stage: "disconnected" };

export function useDisconnectedViewModel(): DisconnectedViewModel {
  const { connection } = useMobileExperience();
  return { ...connection, stage: "disconnected" };
}
