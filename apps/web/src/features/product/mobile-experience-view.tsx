import { ConnectionFlowView } from "../connection/connection-flow-view";
import { ConnectionSettingsView } from "../connection/connection-settings-view";
import { PaneView } from "../pane/pane-view";
import { NewSessionView } from "../session/new-session-view";
import { NewPaneView } from "../pane/new-pane-view";
import { SessionOverviewView } from "../session/session-overview-view";
import type { MobileExperienceViewModel } from "./mobile-experience-viewmodel";

export function MobileExperienceView({ viewModel }: { viewModel: MobileExperienceViewModel }) {
  if (viewModel.stage === "settings") return <ConnectionSettingsView viewModel={viewModel.connectionSettings} />;
  if (viewModel.stage === "new-session") return <NewSessionView viewModel={viewModel.newSession} />;
  if (viewModel.stage === "new-pane") return <NewPaneView viewModel={viewModel.newPane} />;
  if (viewModel.stage === "session-overview") return <SessionOverviewView viewModel={viewModel.sessionOverview} />;
  if (viewModel.stage === "control-room") {
    return <PaneView viewModel={viewModel.terminalView} paneBoard={viewModel.paneBoard} onWorkspaceSwitch={viewModel.onWorkspaceSwitch} onNewPane={viewModel.onOpenNewPane} />;
  }
  return <ConnectionFlowView viewModel={viewModel.connection} />;
}
