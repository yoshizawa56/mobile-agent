import type { ConnectionSettingsViewModel } from "./connection-settings-viewmodel";
import { QrPairingScanner } from "./qr-pairing-scanner";

export function ConnectionSettingsView({ viewModel }: { viewModel: ConnectionSettingsViewModel }) {
  return (
    <main className="connection-settings-view">
      <header className="connection-settings-toolbar">
        {viewModel.hasSavedProfile ? <button className="connection-flow-back" type="button" onClick={viewModel.onBack}>‹ <span>connections</span></button> : <span className="connection-flow-back">connection setup</span>}
        <span className="connection-settings-lockup"><span className="connection-flow-network-dot" /> AGENTD CONNECTION</span>
      </header>

      <section className="connection-settings-content">
        <div className="connection-flow-intro">
          <span className="connection-flow-step"><span className="connection-flow-step-line" /> CONNECTION SETTINGS</span>
          <h1>Where is agentd?</h1>
          <p>Run agent pair on the host to display a QR code, then scan it here. The destination is not bundled with the build; the browser&apos;s private key is stored in IndexedDB, and only the public key is registered with the server.</p>
        </div>

        {viewModel.isPairingQr ? <div className="connection-qr-status" role="status">{viewModel.pairingMessage ?? "Pairing…"}</div> : null}
        {viewModel.isScanningQr && viewModel.onQrValue && viewModel.onCloseQrScanner ? (
          <QrPairingScanner onScan={viewModel.onQrValue} onClose={viewModel.onCloseQrScanner} />
        ) : null}

        {!viewModel.isScanningQr && !viewModel.isPairingQr && viewModel.onOpenQrScanner ? (
          <button className="connection-flow-primary connection-qr-open" type="button" onClick={viewModel.onOpenQrScanner}>
            Scan QR code to pair<span>⌁</span>
          </button>
        ) : null}

        <form className="connection-settings-form" onSubmit={(event) => { event.preventDefault(); viewModel.onSave(); }}>
          <label className="new-session-field">
            <span>DISPLAY NAME</span>
            <input value={viewModel.name} onChange={(event) => viewModel.onNameChange(event.target.value)} placeholder="My workstation" autoComplete="off" />
            <small>Shown in the terminal picker on this device.</small>
          </label>
          <label className="new-session-field">
            <span>CONNECTION URL</span>
            <input value={viewModel.agentdBaseUrl} onChange={(event) => viewModel.onAgentdBaseUrlChange(event.target.value)} placeholder="https://workstation.tailnet.ts.net:8444" autoComplete="url" inputMode="url" spellCheck={false} />
            <small>Use the full agentd URL. Include <code>:port</code> when the endpoint uses a non-default port.</small>
          </label>

          <div className="connection-settings-note">
            <span className="connection-settings-note-icon">⌁</span>
            <span><strong>Agentd endpoint + device key</strong><small>Network access is controlled by your route and tailnet ACL. SSH forwarding and other routes can reuse the same pairing/auth layer.</small></span>
          </div>
          {viewModel.errorMessage ? <p className="new-session-error" role="alert">{viewModel.errorMessage}</p> : null}

          <button className="connection-flow-primary" type="submit" disabled={viewModel.isSaving || !viewModel.agentdBaseUrl.trim()}>
            {viewModel.isSaving ? "Saving…" : "Save and connect"}<span>→</span>
          </button>
          {viewModel.hasSavedProfile ? <button className="connection-flow-secondary connection-settings-clear" type="button" onClick={viewModel.onClear}>Forget saved address</button> : null}
        </form>
      </section>
    </main>
  );
}
