import { useMobileExperience } from "../../../../../../../app/mobile-experience-context";
import type { PaneBoardViewModel } from "../../../../../../../features/pane-board/pane-board-viewmodel";
import type { PaneViewModel } from "../../../../../../../features/pane/pane-viewmodel";

export type ControlRoomViewModel = {
  terminal: PaneViewModel;
  paneBoard: PaneBoardViewModel;
  onSessionSelect: () => void;
  onNewPane: () => void;
};

export function useControlRoomViewModel(): ControlRoomViewModel {
  const { terminalView, paneBoard, onSessionSelect, onOpenNewPane } = useMobileExperience();
  return { terminal: terminalView, paneBoard, onSessionSelect, onNewPane: onOpenNewPane };
}
