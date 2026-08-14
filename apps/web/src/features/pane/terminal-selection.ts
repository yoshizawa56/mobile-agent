import type { Terminal } from "@xterm/xterm";

export const TERMINAL_SELECTION_LONG_PRESS_MS = 450;
export const TERMINAL_SELECTION_MOVE_TOLERANCE_PX = 12;

type TerminalCell = {
  column: number;
  row: number;
};

type TerminalSelectionGeometry = Pick<Terminal, "cols" | "rows" | "buffer">;

export type TerminalSelectionGestureOptions = {
  isSelectionMode: () => boolean;
  onSelectionModeChange: (active: boolean) => void;
};

/**
 * Converts a point on the rendered terminal grid into a zero-based xterm
 * buffer coordinate. Keeping this here makes the long-press gesture independent
 * from React state and lets the terminal keep owning the actual selection.
 */
export function terminalCellFromPoint(
  terminal: TerminalSelectionGeometry,
  screen: HTMLElement,
  clientX: number,
  clientY: number,
): TerminalCell | null {
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) return null;

  const column = clamp(Math.floor(((clientX - rect.left) / rect.width) * terminal.cols), 0, terminal.cols - 1);
  const viewportRow = clamp(Math.floor(((clientY - rect.top) / rect.height) * terminal.rows), 0, terminal.rows - 1);
  const activeBuffer = terminal.buffer.active;
  const row = clamp(viewportRow + activeBuffer.viewportY, 0, Math.max(activeBuffer.length - 1, 0));
  return { column, row };
}

export function terminalSelectionLength(start: TerminalCell, end: TerminalCell, columns: number): number {
  const startOffset = start.row * columns + start.column;
  const endOffset = end.row * columns + end.column;
  return Math.max(1, Math.abs(endOffset - startOffset) + 1);
}

export function installTerminalSelectionGesture(
  container: HTMLElement,
  terminal: Terminal,
  options: TerminalSelectionGestureOptions,
): () => void {
  let pending: {
    pointerId: number;
    x: number;
    y: number;
    timer: number | null;
    started: boolean;
    startCell: TerminalCell | null;
  } | null = null;
  const activePointers = new Set<number>();

  const screenElement = () => terminal.element?.querySelector<HTMLElement>(".xterm-screen") ?? terminal.element ?? container;

  const clearPending = () => {
    const timer = pending?.timer;
    if (timer !== null && timer !== undefined) window.clearTimeout(timer);
    pending = null;
  };

  const startSelection = (clientX: number, clientY: number) => {
    const cell = terminalCellFromPoint(terminal, screenElement(), clientX, clientY);
    if (!cell) return false;
    pending!.started = true;
    pending!.startCell = cell;
    options.onSelectionModeChange(true);
    terminal.focus();
    terminal.select(cell.column, cell.row, 1);
    return true;
  };

  const updateSelection = (clientX: number, clientY: number) => {
    if (!pending?.started || !pending.startCell) return;
    const cell = terminalCellFromPoint(terminal, screenElement(), clientX, clientY);
    if (!cell) return;
    const startOffset = pending.startCell.row * terminal.cols + pending.startCell.column;
    const endOffset = cell.row * terminal.cols + cell.column;
    const start = startOffset <= endOffset ? pending.startCell : cell;
    terminal.select(start.column, start.row, terminalSelectionLength(pending.startCell, cell, terminal.cols));
  };

  const stopEvent = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) {
      // A second finger belongs to pinch/window-map handling. It must never
      // turn the first finger into a text selection or an arrow-key flick.
      clearPending();
      return;
    }

    const selectionMode = options.isSelectionMode();
    pending = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: null,
      started: false,
      startCell: null,
    };
    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not available in a few embedded webviews; the
      // gesture still works while the finger remains over the terminal.
    }

    if (selectionMode) {
      if (startSelection(event.clientX, event.clientY)) stopEvent(event);
      return;
    }

    pending.timer = window.setTimeout(() => {
      if (!pending || pending.pointerId !== event.pointerId || activePointers.size !== 1) return;
      pending.timer = null;
      startSelection(event.clientX, event.clientY);
    }, TERMINAL_SELECTION_LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "mouse" || !pending || pending.pointerId !== event.pointerId) return;
    if (activePointers.size > 1) {
      clearPending();
      return;
    }

    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (!pending.started) {
      if (distance > TERMINAL_SELECTION_MOVE_TOLERANCE_PX) clearPending();
      return;
    }

    stopEvent(event);
    updateSelection(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    activePointers.delete(event.pointerId);
    if (!pending || pending.pointerId !== event.pointerId) return;
    const wasSelecting = pending.started;
    clearPending();
    if (wasSelecting) stopEvent(event);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    activePointers.delete(event.pointerId);
    if (pending?.pointerId === event.pointerId) clearPending();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (options.isSelectionMode() || pending?.started) event.preventDefault();
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!pending?.started || activePointers.size !== 1) return;
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) return;
    // Pointer Events can still be cancelled by an embedded WebView's native
    // gesture router. Touch Events are the final cancel-prevention boundary on
    // iOS, so keep the selection drag alive once long-press has activated it.
    stopEvent(event);
    updateSelection(touch.clientX, touch.clientY);
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (pending?.started) event.preventDefault();
  };

  const onTouchCancel = () => {
    if (!pending?.started) return;
    clearPending();
    activePointers.clear();
  };

  container.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
  container.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  container.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
  container.addEventListener("pointercancel", onPointerCancel, { capture: true });
  container.addEventListener("contextmenu", onContextMenu, { capture: true });
  container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  container.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  container.addEventListener("touchcancel", onTouchCancel, { capture: true });

  return () => {
    clearPending();
    activePointers.clear();
    container.removeEventListener("pointerdown", onPointerDown, true);
    container.removeEventListener("pointermove", onPointerMove, true);
    container.removeEventListener("pointerup", onPointerUp, true);
    container.removeEventListener("pointercancel", onPointerCancel, true);
    container.removeEventListener("contextmenu", onContextMenu, true);
    container.removeEventListener("touchmove", onTouchMove, true);
    container.removeEventListener("touchend", onTouchEnd, true);
    container.removeEventListener("touchcancel", onTouchCancel, true);
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
