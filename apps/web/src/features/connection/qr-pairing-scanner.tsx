import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

export function QrPairingScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserQRCodeReader();
    let active = true;
    let controls: { stop: () => void } | undefined;
    const start = async () => {
      try {
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current ?? undefined,
          (result, _decodeError, scannerControls) => {
            if (!active || !result) return;
            active = false;
            scannerControls.stop();
            onScan(result.getText());
          },
        );
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "カメラを利用できません");
      }
    };
    void start();
    return () => {
      active = false;
      controls?.stop();
    };
  }, [onScan]);

  return (
    <section className="connection-qr-scanner" aria-label="QR code scanner">
      <div className="connection-qr-video-frame">
        <video ref={videoRef} muted playsInline />
        <span className="connection-qr-target" />
      </div>
      <p>{error ?? "agent pair に表示されたQRを枠内に合わせてください。"}</p>
      <button className="connection-flow-secondary" type="button" onClick={onClose}>カメラを閉じる</button>
    </section>
  );
}
