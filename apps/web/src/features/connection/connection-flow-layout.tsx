import type { ReactNode } from "react";

export function ConnectionFlowLayout({ children }: { children: ReactNode }) {
  return (
    <main className="connection-flow">
      <header className="connection-flow-topbar">
        <div className="connection-flow-brand"><span className="connection-flow-mark">⌁</span><strong>agent<span>.</span></strong><small>connect</small></div>
        <div className="connection-flow-network"><span className="connection-flow-network-dot" /> TAILNET</div>
      </header>
      {children}
      <footer className="connection-flow-footer">
        <span><span className="connection-flow-footer-dot" /> encrypted over your tailnet</span>
        <span>agentd</span>
      </footer>
    </main>
  );
}

export function FlowIntro({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="connection-flow-intro">
      <span className="connection-flow-step"><span className="connection-flow-step-line" />{step}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
