export type ConnectionSettingsViewModel = {
  name: string;
  serveUrl: string;
  hasSavedProfile: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  onNameChange: (value: string) => void;
  onServeUrlChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onBack: () => void;
};

export function ConnectionSettingsView({ viewModel }: { viewModel: ConnectionSettingsViewModel }) {
  return (
    <main className="connection-settings-view">
      <header className="connection-settings-toolbar">
        <button className="connection-flow-back" type="button" onClick={viewModel.onBack}>‹ <span>connections</span></button>
        <span className="connection-settings-lockup"><span className="connection-flow-network-dot" /> SERVE ROUTE</span>
      </header>

      <section className="connection-settings-content">
        <div className="connection-flow-intro">
          <span className="connection-flow-step"><span className="connection-flow-step-line" /> CONNECTION SETTINGS</span>
          <h1>Where is agentd?</h1>
          <p>Use the HTTPS address exposed by Tailscale Serve. The browser stores only this address — never an SSH key or password.</p>
        </div>

        <form className="connection-settings-form" onSubmit={(event) => { event.preventDefault(); viewModel.onSave(); }}>
          <label className="new-session-field">
            <span>DISPLAY NAME</span>
            <input value={viewModel.name} onChange={(event) => viewModel.onNameChange(event.target.value)} placeholder="My workstation" autoComplete="off" />
            <small>Shown in the terminal picker on this device.</small>
          </label>
          <label className="new-session-field">
            <span>SERVE URL</span>
            <input value={viewModel.serveUrl} onChange={(event) => viewModel.onServeUrlChange(event.target.value)} placeholder="https://workstation.tailnet.ts.net" autoComplete="url" inputMode="url" spellCheck={false} />
            <small>Example: <code>tailscale serve --bg 4317</code> on the host.</small>
          </label>

          <div className="connection-settings-note">
            <span className="connection-settings-note-icon">⌁</span>
            <span><strong>Serve only</strong><small>Network access is controlled by your tailnet ACL. SSH forwarding is a future native-only route.</small></span>
          </div>
          {viewModel.errorMessage ? <p className="new-session-error" role="alert">{viewModel.errorMessage}</p> : null}

          <button className="connection-flow-primary" type="submit" disabled={viewModel.isSaving || !viewModel.serveUrl.trim()}>
            {viewModel.isSaving ? "Saving…" : "Save and connect"}<span>→</span>
          </button>
          {viewModel.hasSavedProfile ? <button className="connection-flow-secondary connection-settings-clear" type="button" onClick={viewModel.onClear}>Forget saved address</button> : null}
        </form>
      </section>
    </main>
  );
}
