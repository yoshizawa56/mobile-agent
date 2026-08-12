import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "./-settings-view";
import { useSettingsViewModel } from "./-settings-viewmodel";

export const Route = createFileRoute("/settings/")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return <SettingsView viewModel={useSettingsViewModel()} />;
}
