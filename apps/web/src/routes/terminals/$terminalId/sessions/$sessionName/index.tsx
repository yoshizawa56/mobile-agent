import { createFileRoute } from "@tanstack/react-router";
import { SessionView } from "./-session-view";
import { useSessionViewModel } from "./-session-viewmodel";

export const Route = createFileRoute("/terminals/$terminalId/sessions/$sessionName/")({
  component: SessionRoute,
});

function SessionRoute() {
  return <SessionView viewModel={useSessionViewModel()} />;
}
