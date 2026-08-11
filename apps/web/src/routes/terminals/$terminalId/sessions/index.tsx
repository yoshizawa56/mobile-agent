import { createFileRoute } from "@tanstack/react-router";
import { SessionsView } from "./-sessions-view";
import { useSessionsViewModel } from "./-sessions-viewmodel";

export const Route = createFileRoute("/terminals/$terminalId/sessions/")({
  component: SessionsRoute,
});

function SessionsRoute() {
  return <SessionsView viewModel={useSessionsViewModel()} />;
}
