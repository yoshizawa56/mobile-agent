import { useMobileExperience } from "../../../../../../../app/mobile-experience-context";
import type { PaneBoardViewModel } from "../../../../../../../features/pane-board/pane-board-viewmodel";
import type { PaneViewModel } from "../../../../../../../features/pane/pane-viewmodel";

export type ControlRoomViewModel = {
  terminal: PaneViewModel;
  paneBoard: PaneBoardViewModel;
  onWorkspaceSwitch: () => void;
  onNewPane: () => void;
};

export function useControlRoomViewModel(): ControlRoomViewModel {
  const { terminalView, paneBoard, onWorkspaceSwitch, onOpenNewPane } = useMobileExperience();
  return { terminal: terminalView, paneBoard, onWorkspaceSwitch, onNewPane: onOpenNewPane };
}
