import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  serverControlMessageSchema,
  terminalProtocolVersion,
  type ClientControlMessage,
  type ServerControlMessage,
} from "@mobile-agent/protocol";
import type { AgentdConnection } from "@mobile-agent/agentd-client";
import { getAgentdWebSocketEndpoint, openAgentdTerminal } from "../api/agentd-api";
import { isMockMode, mockTerminalOutputForTarget } from "../../mock/mock-data";
import { mobileAgentBridge } from "../../platform/mobile-bridge";
import { installTerminalFlickInput } from "./terminal-flick";
import { installTerminalSelectionGesture } from "./terminal-selection";
import { TERMINAL_FONT_FAMILY, waitForTerminalFont } from "./terminal-font";

export type PaneConnectionStatus = "connecting" | "connected" | "closed" | "error";
export type PaneViewportOwner = "mobile" | "desktop";

export type PaneResumeState = {
  sessionId: string;
  resumeToken: string;
  target: string;
};

export type PaneViewModel = {
  target: string;
  status: PaneConnectionStatus;
  errorMessage: string | null;
  viewportOwner: PaneViewportOwner;
  viewportReason: string | null;
  selectionMode: boolean;
  hasSelection: boolean;
  selectionNotice: string | null;
  terminalContainerRef: RefCallback<HTMLDivElement>;
  reconnect: () => void;
  claim: () => void;
  detach: () => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  copySelection: () => Promise<boolean>;
  pasteFromClipboard: () => Promise<boolean>;
};

export function usePaneViewModel({ target, connection }: { target: string; connection?: AgentdConnection }): PaneViewModel {
  const [terminalContainer, setTerminalContainer] = useState<HTMLDivElement | null>(null);
  const terminalContainerRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    setTerminalContainer(node);
  }, []);
  const [status, setStatus] = useState<PaneConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewportOwner, setViewportOwner] = useState<PaneViewportOwner>("mobile");
  const [viewportReason, setViewportReason] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const selectionModeRef = useRef(false);
  const selectionNoticeTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const resumeRef = useRef<PaneResumeState | null>(null);
  const terminalClosedRef = useRef(false);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    terminalClosedRef.current = false;
    clearRetryTimer();
    setStatus("connecting");
    setErrorMessage(null);
    connectRef.current?.();
  }, [clearRetryTimer]);

  const claim = useCallback(() => {
    sendControl(socketRef.current, { type: "claim", version: terminalProtocolVersion });
  }, []);

  const detach = useCallback(() => {
    terminalClosedRef.current = true;
    clearRetryTimer();
    detachRef.current?.();
  }, [clearRetryTimer]);

  const showSelectionNotice = useCallback((message: string) => {
    if (selectionNoticeTimerRef.current !== null) window.clearTimeout(selectionNoticeTimerRef.current);
    setSelectionNotice(message);
    selectionNoticeTimerRef.current = window.setTimeout(() => {
      selectionNoticeTimerRef.current = null;
      setSelectionNotice(null);
    }, 2_400);
  }, []);

  const enterSelectionMode = useCallback(() => {
    selectionModeRef.current = true;
    setSelectionMode(true);
    terminalRef.current?.focus();
  }, []);

  const exitSelectionMode = useCallback(() => {
    selectionModeRef.current = false;
    setSelectionMode(false);
  }, []);

  const selectAll = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    selectionModeRef.current = true;
    setSelectionMode(true);
    terminal.selectAll();
    terminal.focus();
  }, []);

  const clearSelection = useCallback(() => {
    terminalRef.current?.clearSelection();
    selectionModeRef.current = false;
    setSelectionMode(false);
    setHasSelection(false);
  }, []);

  const copySelection = useCallback(async () => {
    const terminal = terminalRef.current;
    const text = terminal?.getSelection() ?? "";
    if (!text) {
      showSelectionNotice("Select a range to copy");
      return false;
    }

    const copied = await writeTextToClipboard(text);
    showSelectionNotice(copied ? "Copied" : "Failed to copy to clipboard");
    return copied;
  }, [showSelectionNotice]);

  const pasteFromClipboard = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal || typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      showSelectionNotice("Pasting is not available in this environment");
      return false;
    }

    try {
      const text = await navigator.clipboard.readText();
      terminal.focus();
      terminal.paste(text);
      showSelectionNotice(text ? "Pasted" : "Clipboard is empty");
      return true;
    } catch {
      showSelectionNotice("Clipboard permission is required to paste");
      return false;
    }
  }, [showSelectionNotice]);

  useEffect(() => mobileAgentBridge.onAppStateChange((state) => {
    if (state === "active" && !terminalClosedRef.current) reconnect();
  }), [reconnect]);

  useEffect(() => {
    // The terminal surface is mounted by the control-room route. The hook lives
    // above that route, so the DOM ref is the reliable lifecycle signal here;
    // gating on the route stage can race with the ref callback during SPA
    // navigation and leave the surface permanently uninitialized.
    if (!target || !terminalContainer || (!connection && !isMockMode())) return;

    const container = terminalContainer;
    const fontSize = terminalFontSize();
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize,
      lineHeight: 1.05,
      letterSpacing: 0,
      scrollback: 10_000,
      theme: {
        background: "#111318",
        foreground: "#f2f4f8",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminalRef.current = terminal;
    setHasSelection(terminal.hasSelection());
    setSelectionMode(selectionModeRef.current);

    const selectionDisposable = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection());
    });
    const selectionGestureCleanup = installTerminalSelectionGesture(container, terminal, {
      isSelectionMode: () => selectionModeRef.current,
      onSelectionModeChange: (active) => {
        selectionModeRef.current = active;
        setSelectionMode(active);
      },
    });

    const endpoint = connection ? getAgentdWebSocketEndpoint(connection) : "mock";
    const storageKey = terminalResumeStorageKey(endpoint, target);
    resumeRef.current = readTerminalResumeState(storageKey, target);
    terminalClosedRef.current = false;
    let disposed = false;
    let resizeFrame: number | null = null;
    let retryScheduled = false;
    let socketGeneration = 0;

    void waitForTerminalFont(fontSize).then(() => {
      if (disposed) return;
      terminal.refresh(0, terminal.rows - 1);
      fitAddon.fit();
    });

    const scheduleReconnect = () => {
      if (disposed || terminalClosedRef.current || retryScheduled || retryCountRef.current >= 8) return;
      retryScheduled = true;
      const attempt = retryCountRef.current++;
      const delay = Math.min(1_000 * 2 ** attempt, 10_000);
      setStatus("connecting");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        retryScheduled = false;
        if (!disposed) connect();
      }, delay);
    };

    const sendResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (disposed) return;

        fitAddon.fit();
        sendControl(socketRef.current, {
          type: "resize",
          version: terminalProtocolVersion,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      });
    };

    const sendAttach = (socket: WebSocket) => {
      const resume = resumeRef.current?.target === target ? resumeRef.current : null;
      const message = createTerminalAttachMessage({
        target,
        cols: terminal.cols,
        rows: terminal.rows,
        resume,
      });
      socket.send(JSON.stringify(message));
    };

    const connect = async () => {
      if (disposed || terminalClosedRef.current) return;
      if (!connection) return;

      const previousSocket = socketRef.current;
      if (previousSocket && (previousSocket.readyState === WebSocket.OPEN || previousSocket.readyState === WebSocket.CONNECTING)) {
        socketRef.current = null;
        closeNetworkSocket(previousSocket);
      }

      let socket: WebSocket;
      try {
        socket = await openAgentdTerminal(connection);
      } catch {
        if (!disposed && !terminalClosedRef.current) {
          setStatus("error");
          setErrorMessage("agentd authentication failed");
          scheduleReconnect();
        }
        return;
      }
      if (disposed || terminalClosedRef.current) {
        closeNetworkSocket(socket);
        return;
      }
      const generation = ++socketGeneration;
      const isCurrentSocket = () => !disposed && socketRef.current === socket && generation === socketGeneration;
      const resumeAttempt = Boolean(resumeRef.current?.target === target);
      let fallbackAttachSent = false;

      socketRef.current = socket;
      socket.binaryType = "arraybuffer";
      setStatus("connecting");
      setErrorMessage(null);

      socket.addEventListener("open", () => {
        if (!isCurrentSocket()) return;
        fitAddon.fit();
        sendAttach(socket);
      });

      socket.addEventListener("message", (event) => {
        if (!isCurrentSocket()) return;
        if (typeof event.data === "string") {
          handleControlMessage(event.data, {
            onReady: (message) => {
              retryCountRef.current = 0;
              terminalClosedRef.current = false;
              setStatus("connected");
              setErrorMessage(null);
              const nextResume = resumeStateFromReady(message, target);
              resumeRef.current = nextResume;
              writeTerminalResumeState(storageKey, nextResume);
            },
            onClosed: (message) => {
              terminalClosedRef.current = true;
              clearTerminalResumeState(storageKey);
              resumeRef.current = null;
              setStatus("closed");
              setErrorMessage(message.reason === "detached" ? "Terminal detached" : "Terminal session closed");
            },
            onError: ({ code, message, retryable }) => {
              if (code === "resume_not_found" && resumeAttempt && !fallbackAttachSent) {
                fallbackAttachSent = true;
                resumeRef.current = null;
                clearTerminalResumeState(storageKey);
                setStatus("connecting");
                sendAttach(socket);
                return;
              }

              setStatus("error");
              setErrorMessage(message);
              if (retryable) scheduleReconnect();
            },
            onViewport: (owner, reason) => {
              setViewportOwner(owner);
              setViewportReason(reason);
            },
          });
          return;
        }

        terminal.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data);
      });

      socket.addEventListener("error", () => {
        if (!isCurrentSocket() || terminalClosedRef.current) return;
        setStatus("error");
        setErrorMessage("WebSocket connection failed");
        scheduleReconnect();
      });

      socket.addEventListener("close", () => {
        if (!isCurrentSocket()) return;
        socketRef.current = null;
        if (terminalClosedRef.current) return;
        setStatus("connecting");
        scheduleReconnect();
      });
    };

    connectRef.current = () => { void connect(); };
    detachRef.current = () => {
      const socket = socketRef.current;
      resumeRef.current = null;
      clearTerminalResumeState(storageKey);
      if (socket?.readyState === WebSocket.OPEN) {
        sendControl(socket, {
          type: "detach",
          version: terminalProtocolVersion,
        });
      } else if (socket?.readyState === WebSocket.CONNECTING) {
        closeNetworkSocket(socket, "detached");
      }
      setStatus("closed");
    };

    let scrollRemainder = 0;
    const scrollTerminal = (deltaY: number) => {
      const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen") ?? terminal.element ?? container;
      const rect = screen.getBoundingClientRect();
      const cellHeight = terminal.rows > 0 && rect.height > 0 ? rect.height / terminal.rows : 0;
      if (!cellHeight) return;

      scrollRemainder += -deltaY / cellHeight;
      const lineDelta = scrollRemainder > 0 ? Math.floor(scrollRemainder) : Math.ceil(scrollRemainder);
      if (!lineDelta) return;
      scrollRemainder -= lineDelta;
      terminal.scrollLines(lineDelta);
    };
    const flickOptions = {
      onGestureStart: () => {
        scrollRemainder = 0;
      },
      onScroll: scrollTerminal,
    };

    if (isMockMode()) {
      setStatus("connected");
      setViewportReason("attached");
      terminal.write(mockTerminalOutputForTarget(target));

      const resizeObserver = new ResizeObserver(sendResize);
      resizeObserver.observe(container);
      window.addEventListener("resize", sendResize);
      sendResize();
      const flickCleanup = installTerminalFlickInput(container, () => {
        // The mock is intentionally read-only. Real input is wired to agentd below.
      }, flickOptions);
      const inputDisposable = terminal.onData(() => {
        // The mock is intentionally read-only.
      });

      return () => {
        disposed = true;
        connectRef.current = null;
        detachRef.current = null;
        clearRetryTimer();
        resizeObserver.disconnect();
        window.removeEventListener("resize", sendResize);
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        selectionGestureCleanup();
        selectionDisposable.dispose();
        flickCleanup();
        inputDisposable.dispose();
        terminalRef.current = null;
        selectionModeRef.current = false;
        setHasSelection(false);
        setSelectionMode(false);
        terminal.dispose();
      };
    }

    const resizeObserver = new ResizeObserver(sendResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", sendResize);

    const inputDisposable = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
    });
    const flickCleanup = installTerminalFlickInput(
      container,
      (data) => {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      },
      flickOptions,
    );
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      sendControl(socketRef.current, { type: "resize", version: terminalProtocolVersion, cols, rows });
    });

    const claimWhenVisible = () => {
      if (document.visibilityState === "visible") claim();
    };
    document.addEventListener("visibilitychange", claimWhenVisible);
    window.addEventListener("focus", claimWhenVisible);
    sendResize();
    void connect();

    return () => {
      disposed = true;
      connectRef.current = null;
      detachRef.current = null;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      clearRetryTimer();
      document.removeEventListener("visibilitychange", claimWhenVisible);
      window.removeEventListener("focus", claimWhenVisible);
      resizeObserver.disconnect();
      window.removeEventListener("resize", sendResize);
      selectionGestureCleanup();
      selectionDisposable.dispose();
      inputDisposable.dispose();
      flickCleanup();
      resizeDisposable.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        // Effect cleanup is a transport loss, not an explicit detach. This
        // lets a remounted pane resume the same PTY during the grace window.
        closeNetworkSocket(socket);
      }
      terminalRef.current = null;
      selectionModeRef.current = false;
      setHasSelection(false);
      setSelectionMode(false);
      terminal.dispose();
    };
  }, [claim, clearRetryTimer, connection, target, terminalContainer]);

  useEffect(() => () => {
    if (selectionNoticeTimerRef.current !== null) window.clearTimeout(selectionNoticeTimerRef.current);
  }, []);

  return {
    target,
    status,
    errorMessage,
    viewportOwner,
    viewportReason,
    selectionMode,
    hasSelection,
    selectionNotice,
    terminalContainerRef,
    reconnect,
    claim,
    detach,
    enterSelectionMode,
    exitSelectionMode,
    selectAll,
    clearSelection,
    copySelection,
    pasteFromClipboard,
  };
}

export function createTerminalAttachMessage({
  target,
  cols,
  rows,
  resume,
}: {
  target: string;
  cols: number;
  rows: number;
  resume?: PaneResumeState | null;
}): Extract<ClientControlMessage, { type: "attach" }> {
  return {
    type: "attach",
    version: terminalProtocolVersion,
    target,
    cols,
    rows,
    ...(resume && resume.target === target ? { sessionId: resume.sessionId, resumeToken: resume.resumeToken } : {}),
  };
}

export function resumeStateFromReady(
  message: Extract<ServerControlMessage, { type: "ready" }>,
  target: string,
): PaneResumeState {
  return {
    sessionId: message.sessionId,
    resumeToken: message.resumeToken,
    target,
  };
}

export function handleControlMessage(
  rawMessage: string,
  handlers: {
    onReady: (message: Extract<ServerControlMessage, { type: "ready" }>) => void;
    onClosed: (message: Extract<ServerControlMessage, { type: "closed" }>) => void;
    onError: (message: { code: string; message: string; retryable: boolean }) => void;
    onViewport: (owner: PaneViewportOwner, reason: string) => void;
  },
): void {
  try {
    const parsed = serverControlMessageSchema.safeParse(JSON.parse(rawMessage));
    if (!parsed.success) {
      handlers.onError({ code: "invalid_control_frame", message: "Invalid control frame from agentd", retryable: false });
      return;
    }

    const message = parsed.data;
    if (message.type === "ready") handlers.onReady(message);
    if (message.type === "closed") handlers.onClosed(message);
    if (message.type === "error") handlers.onError({ code: message.code, message: message.message, retryable: message.retryable ?? false });
    if (message.type === "viewport") handlers.onViewport(message.owner, message.reason);
  } catch {
    handlers.onError({ code: "invalid_control_frame", message: "Invalid control frame from agentd", retryable: false });
  }
}

function sendControl(socket: WebSocket | null, message: ClientControlMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function closeNetworkSocket(socket: WebSocket, reason?: string): void {
  try {
    socket.close(1000, reason ?? "network-lost");
  } catch {
    // The browser may have completed the close handshake already.
  }
}

function terminalResumeStorageKey(endpoint: string, target: string): string {
  return `mobile-agent:terminal-resume:${endpoint}:${target}`;
}

function readTerminalResumeState(storageKey: string, target: string): PaneResumeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isResumeState(value) || value.target !== target) return null;
    return value;
  } catch {
    return null;
  }
}

function writeTerminalResumeState(storageKey: string, state: PaneResumeState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private browsing or an embedded shell.
  }
}

function clearTerminalResumeState(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage can be unavailable in private browsing or an embedded shell.
  }
}

function isResumeState(value: unknown): value is PaneResumeState {
  if (typeof value !== "object" || value === null) return false;
  return "sessionId" in value && typeof value.sessionId === "string"
    && "resumeToken" in value && typeof value.resumeToken === "string"
    && "target" in value && typeof value.target === "string";
}

function terminalFontSize(): number {
  if (typeof window !== "undefined" && window.innerWidth <= 620) return 11;
  if (typeof window !== "undefined" && window.innerWidth <= 920) return 12;
  return 12;
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy copy path for embedded or older browsers.
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
