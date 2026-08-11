import { createFileRoute } from "@tanstack/react-router";
import { DisconnectedView } from "./-disconnected-view";
import { useDisconnectedViewModel } from "./-disconnected-viewmodel";

export const Route = createFileRoute("/terminals/$terminalId/sessions/$sessionName/disconnected/")({
  component: DisconnectedRoute,
});

function DisconnectedRoute() {
  return <DisconnectedView viewModel={useDisconnectedViewModel()} />;
}
