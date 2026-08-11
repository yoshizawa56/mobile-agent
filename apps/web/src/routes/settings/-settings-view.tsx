import { ConnectionSettingsView } from "../../features/connection/connection-settings-view";
import type { ConnectionSettingsViewModel } from "../../features/connection/connection-settings-viewmodel";

export function SettingsView({ viewModel }: { viewModel: ConnectionSettingsViewModel }) {
  return <ConnectionSettingsView viewModel={viewModel} />;
}
