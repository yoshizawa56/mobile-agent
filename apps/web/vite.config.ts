import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { WebSocketServer } from "ws";

const agentdProxyTarget = process.env.VITE_AGENTD_PROXY_TARGET;
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);
const devHost = process.env.VITE_DEV_HOST ?? "0.0.0.0";
const devPort = Number(process.env.VITE_DEV_PORT ?? 5227);
const previewPort = Number(process.env.VITE_PREVIEW_PORT ?? 4173);

export default defineConfig({
  // The web app uses clean TanStack Router paths. Vite dev/preview must serve
  // index.html for those paths on a hard reload.
  appType: "spa",
  plugins: [tanstackRouter(), react(), agentdWebSocketProxy()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    ...(agentdProxyTarget ? {
      proxy: {
        "/api": {
          target: agentdProxyTarget,
        },
      },
    } : {}),
  },
  preview: {
    port: previewPort,
    host: "0.0.0.0",
    strictPort: true,
  },
});

function agentdWebSocketProxy(): Plugin {
  return {
    name: "mobile-agent-agentd-websocket-proxy",
    apply: "serve",
    configureServer(server) {
      const target = agentdProxyTarget;
      if (!target) return;

      const webSocketServer = new WebSocketServer({ noServer: true });
      const httpServer = server.httpServer;
      if (!httpServer) return;

      return () => {
        httpServer.on("upgrade", (request, socket, head) => {
          const requestUrl = new URL(request.url ?? "/", "http://mobile-agent.local");
          if (requestUrl.pathname !== "/terminal" && requestUrl.pathname !== "/events") return;

          webSocketServer.handleUpgrade(request, socket, head, (client) => {
            webSocketServer.emit("connection", client, request);
            const upstreamUrl = websocketTarget(target, requestUrl.pathname, requestUrl.search);
            const upstream = new globalThis.WebSocket(upstreamUrl);
            let upstreamReady = false;
            const pendingFrames: Array<string | ArrayBuffer> = [];

            client.on("message", (data, isBinary) => {
              const frame = isBinary ? rawDataToBytes(data) : data.toString();
              if (upstreamReady && upstream.readyState === globalThis.WebSocket.OPEN) upstream.send(frame);
              else if (upstream.readyState === globalThis.WebSocket.CONNECTING) pendingFrames.push(frame);
            });
            client.on("close", () => {
              if (upstream.readyState === globalThis.WebSocket.OPEN || upstream.readyState === globalThis.WebSocket.CONNECTING) upstream.close();
            });
            client.on("error", () => upstream.close());

            upstream.onopen = () => {
              if (client.readyState !== 1) {
                upstream.close();
                return;
              }
              upstreamReady = true;
              for (const frame of pendingFrames) upstream.send(frame);
              pendingFrames.length = 0;
            };
            upstream.onmessage = (event) => {
              if (client.readyState !== 1) return;
              if (typeof event.data === "string") client.send(event.data);
              else {
                const binary = binaryMessageToBuffer(event.data);
                if (binary) client.send(binary);
                else if (isBlobMessage(event.data)) {
                  void event.data.arrayBuffer().then((data) => {
                    if (client.readyState === 1) client.send(Buffer.from(data));
                  });
                }
              }
            };
            upstream.onclose = (event) => {
              if (client.readyState === 1) client.close(event.code, event.reason);
            };
            upstream.onerror = () => {
              if (!upstreamReady && client.readyState === 1) client.close(1011, "agentd unavailable");
            };
          });
        });
      };
    },
  };
}

function websocketTarget(proxyTarget: string, pathname: string, search: string): string {
  const target = new URL(proxyTarget);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = `${basePath}${pathname}`;
  target.search = search;
  return target.toString();
}

function rawDataToBytes(data: Buffer | ArrayBuffer | Buffer[]): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const bytes = Array.isArray(data) ? Buffer.concat(data) : data;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function binaryMessageToBuffer(data: unknown): Buffer | undefined {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
}

function isBlobMessage(data: unknown): data is Blob {
  return typeof Blob !== "undefined" && data instanceof Blob;
}
