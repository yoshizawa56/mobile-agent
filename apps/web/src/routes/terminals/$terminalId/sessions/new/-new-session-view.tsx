import { NewSessionView } from "../../../../../features/session/new-session-view";
import type { NewSessionViewModel } from "../../../../../features/session/new-session-viewmodel";

export function NewSessionRouteView({ viewModel }: { viewModel: NewSessionViewModel }) {
  return <NewSessionView viewModel={viewModel} />;
}
