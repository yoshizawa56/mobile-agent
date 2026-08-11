import { ConnectionFlowLayout, FlowIntro } from "../../../../../../features/connection/connection-flow-layout";
import type { EndedViewModel } from "./-ended-viewmodel";

export function EndedView({ viewModel }: { viewModel: EndedViewModel }) {
  return (
    <ConnectionFlowLayout>
      <div className="connection-flow-content connection-flow-centered">
        <div className="connection-ended-mark">×</div>
        <FlowIntro step="SHELL ENDED" title="The shell has closed" description={`${viewModel.selectedSession?.name ?? "tmux session"} is no longer attached to this phone.`} />
        <div className="connection-ended-card"><span><small>PROCESS</small><strong>zsh</strong></span><span><small>EXIT</small><strong>0</strong></span><span><small>SESSION</small><strong>{viewModel.selectedSession?.name ?? "—"}</strong></span></div>
        <p className="connection-flow-note"><span className="connection-flow-note-icon">i</span> The tmux session is still available. Reconnecting will not create a duplicate shell.</p>
        <button className="connection-flow-primary" type="button" onClick={viewModel.onReconnect}>Reconnect to session<span>→</span></button>
        <button className="connection-flow-secondary" type="button" onClick={viewModel.onChooseTerminal}>Choose another terminal</button>
      </div>
    </ConnectionFlowLayout>
  );
}
