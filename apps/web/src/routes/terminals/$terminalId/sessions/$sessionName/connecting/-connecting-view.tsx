import { ConnectionFlowLayout, FlowIntro } from "../../../../../../features/connection/connection-flow-layout";
import type { ConnectingViewModel } from "./-connecting-viewmodel";

export function ConnectingView({ viewModel }: { viewModel: ConnectingViewModel }) {
  const steps = ["Reach terminal over Tailscale", "Authenticate with agentd", `Attach to ${viewModel.selectedSession?.name ?? "tmux"}`];
  return (
    <ConnectionFlowLayout>
      <div className="connection-flow-content connection-flow-centered">
        <span className="connection-flow-loader" aria-hidden="true"><span /><span /><span /></span>
        <FlowIntro step="CONNECTING" title="Opening your workspace" description={`${viewModel.selectedTerminal?.name ?? "Terminal"} · ${viewModel.selectedSession?.name ?? "tmux session"}`} />
        <div className="connection-progress-list">
          {steps.map((step, index) => <div className={`connection-progress-step${index < viewModel.connectionStep ? " connection-progress-step-done" : index === viewModel.connectionStep ? " connection-progress-step-active" : ""}`} key={step}><span>{index < viewModel.connectionStep ? "✓" : index + 1}</span><small>{step}</small></div>)}
        </div>
        <button className="connection-flow-primary" type="button" onClick={viewModel.onOpenSessionOverview}>Open session overview<span>→</span></button>
        <button className="connection-flow-secondary" type="button" onClick={viewModel.onBack}>Cancel</button>
      </div>
    </ConnectionFlowLayout>
  );
}
