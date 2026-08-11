import { useMobileExperience } from "../../../../app/mobile-experience-context";
import type { ConnectionFlowViewModel } from "../../../../features/connection/connection-flow-viewmodel";

export type SessionsViewModel = Omit<ConnectionFlowViewModel, "stage"> & { stage: "sessions" };

export function useSessionsViewModel(): SessionsViewModel {
  const { connection } = useMobileExperience();
  return { ...connection, stage: "sessions" };
}
