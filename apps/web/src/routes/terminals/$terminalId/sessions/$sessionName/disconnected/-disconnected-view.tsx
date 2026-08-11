import { ConnectionFlowLayout, FlowIntro } from "../../../../../../features/connection/connection-flow-layout";
import type { DisconnectedViewModel } from "./-disconnected-viewmodel";

export function DisconnectedView({ viewModel }: { viewModel: DisconnectedViewModel }) {
  return (
    <ConnectionFlowLayout>
      <div className="connection-flow-content connection-flow-centered">
        <div className="connection-disconnected-mark">↯</div>
        <FlowIntro step="DISCONNECTED" title="Mobile is disconnected" description="The tmux session is still running on the terminal." />
        <div className="connection-summary-card"><span><small>TERMINAL</small><strong>{viewModel.selectedTerminal?.name}</strong><em>{viewModel.selectedTerminal?.tailnetIp}</em></span><span><small>SESSION</small><strong>{viewModel.selectedSession?.name}</strong><em>session preserved</em></span></div>
        <button className="connection-flow-primary" type="button" onClick={viewModel.onReconnect}>Reconnect to session<span>→</span></button>
        <button className="connection-flow-secondary" type="button" onClick={viewModel.onChooseTerminal}>Choose another terminal</button>
      </div>
    </ConnectionFlowLayout>
  );
}
