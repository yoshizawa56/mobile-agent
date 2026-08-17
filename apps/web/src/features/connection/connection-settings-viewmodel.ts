import type { MobileAgentAppInfo } from "../../platform/mobile-bridge";

export type ConnectionSettingsViewModel = {
  appInfo: MobileAgentAppInfo;
  hasSavedProfile: boolean;
  isScanningQr: boolean;
  isPairingQr: boolean;
  pairingMessage: string | null;
  errorMessage: string | null;
  onClear: () => void;
  onBack: () => void;
  onOpenQrScanner: () => void;
  onCloseQrScanner: () => void;
  onQrValue: (value: string) => void;
};
