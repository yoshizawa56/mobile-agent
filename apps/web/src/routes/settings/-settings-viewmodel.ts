import { useMobileExperience } from "../../app/mobile-experience-context";
import type { ConnectionSettingsViewModel } from "../../features/connection/connection-settings-viewmodel";

export function useSettingsViewModel(): ConnectionSettingsViewModel {
  return useMobileExperience().connectionSettings;
}
