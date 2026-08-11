import { createFileRoute } from "@tanstack/react-router";
import { ConnectingView } from "./-connecting-view";
import { useConnectingViewModel } from "./-connecting-viewmodel";

export const Route = createFileRoute("/terminals/$terminalId/sessions/$sessionName/connecting/")({
  component: ConnectingRoute,
});

function ConnectingRoute() {
  return <ConnectingView viewModel={useConnectingViewModel()} />;
}
