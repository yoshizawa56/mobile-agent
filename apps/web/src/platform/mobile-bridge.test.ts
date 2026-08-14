import { afterEach, describe, expect, it, vi } from "vitest";
import { createMobileAgentBridge } from "./mobile-bridge";

describe("mobile agent bridge", () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("uses the web platform and keeps native-only capabilities disabled in the MVP", () => {
    expect(createMobileAgentBridge()).toMatchObject({
      platform: "web",
      isNative: false,
      capabilities: {
        appLifecycle: true,
        routeProvider: false,
        keychain: false,
        notifications: false,
        liveActivities: false,
      },
    });
  });

  it("forwards WebView visibility changes as app state changes", () => {
    const listeners = new Set<() => void>();
    const documentStub = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_eventName: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as () => void);
      },
      removeEventListener: (_eventName: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as () => void);
      },
      dispatchVisibilityChange: () => {
        for (const listener of listeners) listener();
      },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });

    const bridge = createMobileAgentBridge();
    const states: string[] = [];
    const unsubscribe = bridge.onAppStateChange((state) => states.push(state));

    documentStub.visibilityState = "hidden";
    documentStub.dispatchVisibilityChange();
    documentStub.visibilityState = "visible";
    documentStub.dispatchVisibilityChange();
    unsubscribe();
    documentStub.visibilityState = "hidden";
    documentStub.dispatchVisibilityChange();

    expect(states).toEqual(["background", "active"]);
  });
});
