import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const agentdProxyTarget = process.env.VITE_AGENTD_PROXY_TARGET ?? "http://127.0.0.1:4317";
const agentdWsProxyTarget = agentdProxyTarget.replace(/^http/, "ws");
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);
const devHost = process.env.VITE_DEV_HOST ?? "0.0.0.0";
const devPort = Number(process.env.VITE_DEV_PORT ?? 5227);
const previewPort = Number(process.env.VITE_PREVIEW_PORT ?? 4173);

export default defineConfig({
  // The web app uses clean TanStack Router paths. Vite dev/preview must serve
  // index.html for those paths on a hard reload.
  appType: "spa",
  plugins: [tanstackRouter(), react()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    proxy: {
      "/api": {
        target: agentdProxyTarget,
      },
      // Use an exact regex: a prefix proxy for "/terminal" also matches the
      // TanStack Router's "/terminals/..." document paths.
      "^/terminal$": {
        target: agentdWsProxyTarget,
        ws: true,
      },
      "^/events$": {
        target: agentdWsProxyTarget,
        ws: true,
      },
    },
  },
  preview: {
    port: previewPort,
    host: "0.0.0.0",
    strictPort: true,
  },
});
