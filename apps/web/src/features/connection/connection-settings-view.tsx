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
          <span className="connection-flow-step"><span className="connection-flow-step-line" /> PAIR WITH AGENTD</span>
          <h1>Scan the pairing QR</h1>
          <p>Run agent pair on the host, then scan the QR code shown in the terminal.</p>
        </div>

        {viewModel.errorMessage && !viewModel.isPairingQr ? <p className="connection-qr-error" role="alert">{viewModel.errorMessage}</p> : null}
        {viewModel.isPairingQr ? <div className="connection-qr-status" role="status">{viewModel.pairingMessage ?? "Pairing…"}</div> : null}
        {viewModel.isScanningQr ? <QrPairingScanner onScan={viewModel.onQrValue} onClose={viewModel.onCloseQrScanner} /> : null}

        {!viewModel.isScanningQr && !viewModel.isPairingQr ? (
          <button className="connection-flow-primary connection-qr-open" type="button" onClick={viewModel.onOpenQrScanner}>
            Scan QR code<span>⌁</span>
          </button>
        ) : null}

        {viewModel.hasSavedProfile && !viewModel.isScanningQr && !viewModel.isPairingQr ? <button className="connection-flow-secondary connection-settings-clear" type="button" onClick={viewModel.onClear}>Forget saved connection</button> : null}
      </section>
    </main>
  );
}
