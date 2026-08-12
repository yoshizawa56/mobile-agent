import { createFileRoute } from "@tanstack/react-router";
import { NewSessionRouteView } from "./-new-session-view";
import { useNewSessionViewModel } from "./-new-session-viewmodel";

export const Route = createFileRoute("/terminals/$terminalId/sessions/new/")({
  component: NewSessionRoute,
});

function NewSessionRoute() {
  return <NewSessionRouteView viewModel={useNewSessionViewModel()} />;
}
