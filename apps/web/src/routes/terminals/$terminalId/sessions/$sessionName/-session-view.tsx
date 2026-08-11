import { SessionOverviewView } from "../../../../../features/session/session-overview-view";
import type { SessionOverviewViewModel } from "../../../../../features/session/session-overview-viewmodel";

export function SessionView({ viewModel }: { viewModel: SessionOverviewViewModel }) {
  return <SessionOverviewView viewModel={viewModel} />;
}
