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
