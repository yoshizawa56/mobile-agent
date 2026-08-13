import { useEffect } from "react";

/**
 * Keep CSS in sync with the visual viewport when browser chrome or the
 * software keyboard changes the usable height. `dvh` remains the fallback for
 * browsers without VisualViewport support.
 */
export function useMobileViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    const visualViewport = window.visualViewport;
    const update = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-viewport-height", `${Math.max(1, Math.round(height))}px`);
    };

    update();
    window.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);
}
