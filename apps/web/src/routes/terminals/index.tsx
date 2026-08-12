import { createFileRoute } from "@tanstack/react-router";
import { TerminalsView } from "./-terminals-view";
import { useTerminalsViewModel } from "./-terminals-viewmodel";

export const Route = createFileRoute("/terminals/")({
  component: TerminalsRoute,
});

function TerminalsRoute() {
  return <TerminalsView viewModel={useTerminalsViewModel()} />;
}
