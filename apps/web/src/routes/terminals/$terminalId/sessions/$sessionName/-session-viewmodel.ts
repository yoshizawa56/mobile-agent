import { useMobileExperience } from "../../../../../app/mobile-experience-context";
import type { SessionOverviewViewModel } from "../../../../../features/session/session-overview-viewmodel";

export function useSessionViewModel(): SessionOverviewViewModel {
  return useMobileExperience().sessionOverview;
}
