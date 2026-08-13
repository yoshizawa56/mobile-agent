import { useEffect } from "react";
import type { ConnectionSettingsViewModel } from "./connection-settings-viewmodel";
import { QrPairingScanner } from "./qr-pairing-scanner";

export function ConnectionSettingsView({ viewModel }: { viewModel: ConnectionSettingsViewModel }) {
  useEffect(() => {
    if (!window.location.hash.startsWith("#ma1=") || !viewModel.onQrValue) return;
    const pairingUrl = window.location.href;
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    viewModel.onQrValue(pairingUrl);
  }, [viewModel.onQrValue]);

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
          <p>最初の接続はagent pairのQRで行います。ブラウザ側の秘密鍵はOSのIndexedDBに保存し、サーバーには公開鍵だけを登録します。</p>
        </div>

        {viewModel.isPairingQr ? <div className="connection-qr-status" role="status">{viewModel.pairingMessage ?? "ペアリング中…"}</div> : null}
        {viewModel.isScanningQr && viewModel.onQrValue && viewModel.onCloseQrScanner ? (
          <QrPairingScanner onScan={viewModel.onQrValue} onClose={viewModel.onCloseQrScanner} />
        ) : null}

        {!viewModel.isScanningQr && !viewModel.isPairingQr && viewModel.onOpenQrScanner ? (
          <button className="connection-flow-primary connection-qr-open" type="button" onClick={viewModel.onOpenQrScanner}>
            QRコードを読み取ってペアリング<span>⌁</span>
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
            <input value={viewModel.serveUrl} onChange={(event) => viewModel.onServeUrlChange(event.target.value)} placeholder="https://workstation.tailnet.ts.net:8449" autoComplete="url" inputMode="url" spellCheck={false} />
            <small>Use the full Serve URL. Include <code>:port</code> when Serve uses a non-default port.</small>
          </label>

          <div className="connection-settings-note">
            <span className="connection-settings-note-icon">⌁</span>
            <span><strong>Serve + device key</strong><small>Network access is controlled by your tailnet ACL. SSH forwarding and other routes can reuse the same pairing/auth layer.</small></span>
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
