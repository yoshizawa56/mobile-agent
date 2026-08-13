import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

export type MobileAgentPlatform = "web" | "ios" | "android";
export type MobileAgentAppState = "active" | "background";

export type MobileAgentBridge = {
  readonly platform: MobileAgentPlatform;
  readonly isNative: boolean;
  readonly capabilities: {
    appLifecycle: true;
    routeProvider: false;
    keychain: false;
    notifications: false;
    liveActivities: false;
  };
  getAppState(): MobileAgentAppState;
  onAppStateChange(listener: (state: MobileAgentAppState) => void): () => void;
};

const capabilities = {
  appLifecycle: true,
  routeProvider: false,
  keychain: false,
  notifications: false,
  liveActivities: false,
} as const;

/**
 * Keeps native-only responsibilities behind one boundary. The MVP uses
 * HTTPS/WSS through Tailscale Serve, so no native route or secret bridge is
 * installed yet. App lifecycle events are still useful to reconnect the
 * foreground terminal after iOS suspends the WebView.
 */
export function createMobileAgentBridge(): MobileAgentBridge {
  const platform = normalizePlatform(Capacitor.getPlatform());
  return {
    platform,
    isNative: Capacitor.isNativePlatform(),
    capabilities,
    getAppState: () => currentAppState(),
    onAppStateChange: (listener) => subscribeToAppState(listener),
  };
}

export const mobileAgentBridge = createMobileAgentBridge();

function normalizePlatform(platform: string): MobileAgentPlatform {
  if (platform === "ios" || platform === "android") return platform;
  return "web";
}

function currentAppState(): MobileAgentAppState {
  return typeof document === "undefined" || document.visibilityState === "visible" ? "active" : "background";
}

function subscribeToAppState(listener: (state: MobileAgentAppState) => void): () => void {
  if (typeof document === "undefined") return () => undefined;

  if (Capacitor.isNativePlatform()) return subscribeToNativeAppState(listener);

  const handleVisibilityChange = () => listener(currentAppState());
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}

function subscribeToNativeAppState(listener: (state: MobileAgentAppState) => void): () => void {
  let disposed = false;
  let handle: PluginListenerHandle | undefined;

  void App.addListener("appStateChange", ({ isActive }) => {
    listener(isActive ? "active" : "background");
  }).then((nextHandle) => {
    if (disposed) {
      void nextHandle.remove();
      return;
    }
    handle = nextHandle;
  });

  return () => {
    disposed = true;
    void handle?.remove();
  };
}
