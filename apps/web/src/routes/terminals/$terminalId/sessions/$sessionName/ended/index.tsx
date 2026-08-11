import { createFileRoute } from "@tanstack/react-router";
import { EndedView } from "./-ended-view";
import { useEndedViewModel } from "./-ended-viewmodel";

export const Route = createFileRoute("/terminals/$terminalId/sessions/$sessionName/ended/")({
  component: EndedRoute,
});

function EndedRoute() {
  return <EndedView viewModel={useEndedViewModel()} />;
}
