export type ConnectionSettingsViewModel = {
  name: string;
  agentdBaseUrl: string;
  hasSavedProfile: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  isScanningQr?: boolean;
  isPairingQr?: boolean;
  pairingMessage?: string | null;
  onNameChange: (value: string) => void;
  onAgentdBaseUrlChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onBack: () => void;
  onOpenQrScanner?: () => void;
  onCloseQrScanner?: () => void;
  onQrValue?: (value: string) => void;
};
