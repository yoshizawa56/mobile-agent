import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

type ScannerControls = { stop: () => void };

export function QrPairingScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserQRCodeReader();
    let active = true;
    let controls: ScannerControls | undefined;
    const video = videoRef.current;

    const stopVideo = () => {
      controls?.stop();
      controls = undefined;

      const stream = video?.srcObject;
      if (stream && "getTracks" in stream && typeof stream.getTracks === "function") {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (video) video.srcObject = null;
    };

    const setCameraError = (cause: unknown) => {
      const name = cause && typeof cause === "object" && "name" in cause && typeof cause.name === "string" ? cause.name : "";

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        const secureContext = typeof window !== "undefined" && window.isSecureContext;
        setError(secureContext ? "この環境ではカメラを利用できません。" : "カメラを使うには HTTPS または localhost で開いてください。");
        return;
      }
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("カメラの使用が許可されていません。ブラウザまたは端末の設定でカメラを許可してください。");
        return;
      }
      if (name === "NotFoundError") {
        setError("利用できるカメラが見つかりません。");
        return;
      }
      if (name === "NotReadableError" || name === "AbortError") {
        setError("カメラを開始できませんでした。他のアプリがカメラを使用していないか確認してください。");
        return;
      }
      setError(cause instanceof Error && cause.message ? cause.message : "カメラを利用できません。");
    };

    const start = async () => {
      if (!video) {
        setError("カメラの表示領域を初期化できません。");
        return;
      }
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(new Error("getUserMedia is unavailable"));
        return;
      }
      try {
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video,
          (result, _decodeError, scannerControls) => {
            if (!active || !result) return;
            active = false;
            scannerControls.stop();
            onScan(result.getText());
          },
        );
        if (!active) stopVideo();
      } catch (cause) {
        if (active) setCameraError(cause);
      }
    };
    void start();
    return () => {
      active = false;
      stopVideo();
    };
  }, [onScan]);

  return (
    <section className="connection-qr-scanner" aria-label="QR code scanner">
      <div className="connection-qr-video-frame">
        <video ref={videoRef} autoPlay muted playsInline />
        <span className="connection-qr-target" />
      </div>
      <p>{error ?? "agent pair に表示されたQRをアプリ内で読み取ってください。"}</p>
      <button className="connection-flow-secondary" type="button" onClick={onClose}>カメラを閉じる</button>
    </section>
  );
}
