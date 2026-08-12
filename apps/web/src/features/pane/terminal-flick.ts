export type TerminalFlickDirection = "up" | "down" | "left" | "right";

const ARROW_INPUT: Record<TerminalFlickDirection, string> = {
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
};

export function classifyTerminalFlick({ dx, dy, durationMs }: { dx: number; dy: number; durationMs: number }): TerminalFlickDirection | null {
  const distance = Math.hypot(dx, dy);
  const duration = Math.max(durationMs, 1);
  const velocity = distance / duration;

  // A slow/short drag belongs to terminal scrolling or text selection.
  if (distance < 28 || duration > 420 || velocity < 0.12) return null;

  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export function terminalInputForFlick(direction: TerminalFlickDirection): string {
  return ARROW_INPUT[direction];
}

export function installTerminalFlickInput(container: HTMLElement, onInput: (data: string) => void): () => void {
  let start: { pointerId: number; x: number; y: number; startedAt: number } | null = null;
  let activeTouchPointers = 0;

  const reset = () => {
    start = null;
    activeTouchPointers = 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    activeTouchPointers += 1;
    if (activeTouchPointers > 1 || start) {
      // A pinch must never finish the first finger's pending flick and send
      // an arrow key to the terminal.
      start = null;
      return;
    }
    start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startedAt: performance.now() };
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    if (activeTouchPointers > 1 || !start || event.pointerId !== start.pointerId) {
      activeTouchPointers = Math.max(activeTouchPointers - 1, 0);
      if (activeTouchPointers === 0) start = null;
      return;
    }

    const direction = classifyTerminalFlick({
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      durationMs: performance.now() - start.startedAt,
    });
    reset();
    if (!direction) return;

    event.preventDefault();
    onInput(terminalInputForFlick(direction));
  };

  container.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
  container.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
  container.addEventListener("pointercancel", reset, { capture: true });
  container.addEventListener("pointerleave", reset, { capture: true });

  return () => {
    container.removeEventListener("pointerdown", onPointerDown, true);
    container.removeEventListener("pointerup", onPointerUp, true);
    container.removeEventListener("pointercancel", reset, true);
    container.removeEventListener("pointerleave", reset, true);
  };
}
