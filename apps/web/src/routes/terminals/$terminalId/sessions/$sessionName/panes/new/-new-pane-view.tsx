import { NewPaneView } from "../../../../../../../features/pane/new-pane-view";
import type { NewPaneViewModel } from "../../../../../../../features/pane/new-pane-viewmodel";

export function NewPaneRouteView({ viewModel }: { viewModel: NewPaneViewModel }) {
  return <NewPaneView viewModel={viewModel} />;
}
