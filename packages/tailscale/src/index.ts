export type TailscaleServeConfig = {
  localPort: number;
};

/**
 * Tailscale 1.52+ uses a foreground `tailscale serve <port>` flow. Keeping
 * the command construction in a tiny adapter makes SSH/bootstrap and the CLI
 * testable without invoking a user's Tailscale installation.
 */
export function buildServeArgs(config: TailscaleServeConfig): string[] {
  if (!Number.isInteger(config.localPort) || config.localPort < 1 || config.localPort > 65_535) {
    throw new Error(`Invalid Tailscale Serve port: ${config.localPort}`);
  }
  return ["serve", String(config.localPort)];
}

export function buildServeUrl(hostname: string, path = "/"): string {
  const normalizedHost = hostname.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `wss://${normalizedHost}${normalizedPath}`;
}
