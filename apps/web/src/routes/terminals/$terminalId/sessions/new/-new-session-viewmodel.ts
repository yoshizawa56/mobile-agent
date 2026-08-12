import { useMobileExperience } from "../../../../../app/mobile-experience-context";
import type { NewSessionViewModel } from "../../../../../features/session/new-session-viewmodel";

export function useNewSessionViewModel(): NewSessionViewModel {
  return useMobileExperience().newSession;
}
