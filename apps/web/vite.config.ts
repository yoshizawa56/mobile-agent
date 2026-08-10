import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const agentdProxyTarget = process.env.VITE_AGENTD_PROXY_TARGET ?? "http://127.0.0.1:4317";
const agentdWsProxyTarget = agentdProxyTarget.replace(/^http/, "ws");
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);

export default defineConfig({
  plugins: [tanstackRouter(), react()],
  server: {
    port: 5173,
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    proxy: {
      "/api": {
        target: agentdProxyTarget,
      },
      "/terminal": {
        target: agentdWsProxyTarget,
        ws: true,
      },
    },
  },
});
