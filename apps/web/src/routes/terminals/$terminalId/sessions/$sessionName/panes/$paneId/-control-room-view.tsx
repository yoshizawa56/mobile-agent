import { PaneView } from "../../../../../../../features/pane/pane-view";
import type { ControlRoomViewModel } from "./-control-room-viewmodel";

export function ControlRoomView({ viewModel }: { viewModel: ControlRoomViewModel }) {
  return <PaneView viewModel={viewModel.terminal} paneBoard={viewModel.paneBoard} onWorkspaceSwitch={viewModel.onWorkspaceSwitch} onNewPane={viewModel.onNewPane} />;
}
