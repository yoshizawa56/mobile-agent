import { useMobileExperience } from "../../../../../../../app/mobile-experience-context";
import type { NewPaneViewModel } from "../../../../../../../features/pane/new-pane-viewmodel";

export function useNewPaneViewModel(): NewPaneViewModel {
  return useMobileExperience().newPane;
}
