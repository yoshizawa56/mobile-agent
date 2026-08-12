import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { serverControlMessageSchema } from "@mobile-agent/protocol";
import type { AgentdConnection } from "@mobile-agent/agentd-client";
import { getAgentdWebSocketEndpoint } from "../api/agentd-api";
import { isMockMode, mockTerminalOutputForTarget } from "../../mock/mock-data";
import { installTerminalFlickInput } from "./terminal-flick";

export type PaneConnectionStatus = "connecting" | "connected" | "closed" | "error";
export type PaneViewportOwner = "mobile" | "desktop";

export type PaneViewModel = {
  target: string;
  status: PaneConnectionStatus;
  errorMessage: string | null;
  viewportOwner: PaneViewportOwner;
  viewportReason: string | null;
  terminalContainerRef: RefCallback<HTMLDivElement>;
  reconnect: () => void;
  claim: () => void;
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
  const [connectionVersion, setConnectionVersion] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setConnectionVersion((version) => version + 1);
  }, []);

  const claim = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "claim" }));
    }
  }, []);

  useEffect(() => {
    // The terminal surface is mounted by the control-room route. The hook lives
    // above that route, so the DOM ref is the reliable lifecycle signal here;
    // gating on the route stage can race with the ref callback during SPA
    // navigation and leave the surface permanently uninitialized.
    if (!target) return;

    const container = terminalContainer;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, monospace',
      fontSize: terminalFontSize(),
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

    if (isMockMode()) {
      setStatus("connected");
      setViewportReason("attached");
      terminal.write(mockTerminalOutputForTarget(target));

      let resizeFrame: number | null = null;
      const resize = () => {
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          fitAddon.fit();
        });
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      window.addEventListener("resize", resize);
      resize();
      const flickCleanup = installTerminalFlickInput(container, () => {
        // The mock is intentionally read-only. Real input is wired to agentd below.
      });
      const inputDisposable = terminal.onData(() => {
        // The mock is intentionally read-only.
      });

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener("resize", resize);
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        flickCleanup();
        inputDisposable.dispose();
        terminal.dispose();
      };
    }

    const endpoint = getAgentdWebSocketEndpoint(connection);
    const socket = new WebSocket(endpoint);
    socketRef.current = socket;
    socket.binaryType = "arraybuffer";
    setStatus("connecting");
    setErrorMessage(null);
    setViewportOwner("mobile");
    setViewportReason(null);

    let lastWidth = -1;
    let lastHeight = -1;
    let resizeFrame: number | null = null;
    let disposed = false;
    let retryScheduled = false;
    const scheduleReconnect = () => {
      if (disposed || retryScheduled || retryCountRef.current >= 8) return;
      retryScheduled = true;
      const attempt = retryCountRef.current++;
      const delay = Math.min(1_000 * 2 ** attempt, 10_000);
      setStatus("connecting");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        retryScheduled = false;
        if (!disposed) setConnectionVersion((version) => version + 1);
      }, delay);
    };
    const sendInput = (data: string) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
    };
    const sendResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (disposed) return;

        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width;
        lastHeight = height;
        fitAddon.fit();
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      });
    };

    const resizeObserver = new ResizeObserver(sendResize);
    resizeObserver.observe(container);

    const inputDisposable = terminal.onData((data) => {
      sendInput(data);
    });
    const flickCleanup = installTerminalFlickInput(container, sendInput);
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    socket.addEventListener("open", () => {
      fitAddon.fit();
      socket.send(
        JSON.stringify({
          type: "attach",
          target,
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        handleControlMessage(event.data, {
          onReady: () => {
            retryCountRef.current = 0;
            setStatus("connected");
          },
          onClosed: () => setStatus("closed"),
          onError: (message) => {
            setStatus("error");
            setErrorMessage(message);
            scheduleReconnect();
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
      setStatus("error");
      setErrorMessage("WebSocket connection failed");
      scheduleReconnect();
    });
    socket.addEventListener("close", () => {
      setStatus((current) => (current === "error" ? current : "closed"));
      scheduleReconnect();
    });

    const claimWhenVisible = () => {
      if (document.visibilityState === "visible") claim();
    };
    document.addEventListener("visibilitychange", claimWhenVisible);
    window.addEventListener("focus", claimWhenVisible);

    return () => {
      disposed = true;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", claimWhenVisible);
      window.removeEventListener("focus", claimWhenVisible);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      flickCleanup();
      resizeDisposable.dispose();
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
      terminal.dispose();
    };
  }, [claim, connectionVersion, target, terminalContainer]);

  return {
    target,
    status,
    errorMessage,
    viewportOwner,
    viewportReason,
    terminalContainerRef,
    reconnect,
    claim,
  };
}

function terminalFontSize(): number {
  if (typeof window !== "undefined" && window.innerWidth <= 620) return 8;
  if (typeof window !== "undefined" && window.innerWidth <= 920) return 10;
  return 12;
}

function handleControlMessage(
  rawMessage: string,
  handlers: {
    onReady: () => void;
    onClosed: () => void;
    onError: (message: string) => void;
    onViewport: (owner: PaneViewportOwner, reason: string) => void;
  },
) {
  try {
    const parsed = serverControlMessageSchema.safeParse(JSON.parse(rawMessage));
    if (!parsed.success) {
      handlers.onError("Invalid control frame from agentd");
      return;
    }

    const message = parsed.data;
    if (message.type === "ready") handlers.onReady();
    if (message.type === "closed") handlers.onClosed();
    if (message.type === "error") handlers.onError(message.message);
    if (message.type === "viewport") handlers.onViewport(message.owner, message.reason);
  } catch {
    handlers.onError("Invalid control frame from agentd");
  }
}
