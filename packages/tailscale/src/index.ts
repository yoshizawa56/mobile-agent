export type TailscaleServeConfig = {
  localPort: number;
  externalPort: number;
  background?: boolean;
  confirm?: boolean;
  path?: string;
};

/**
 * Builds a persistent HTTPS reverse-proxy configuration. The local target is
 * deliberately loopback-only: Tailscale terminates HTTPS and keeps the
 * public-facing listener separate from the worktree-specific local port.
 */
export function buildServeArgs(config: TailscaleServeConfig): string[] {
  if (!Number.isInteger(config.localPort) || config.localPort < 1 || config.localPort > 65_535) {
    throw new Error(`Invalid Tailscale Serve port: ${config.localPort}`);
  }
  if (!Number.isInteger(config.externalPort) || config.externalPort < 1 || config.externalPort > 65_535) {
    throw new Error(`Invalid Tailscale Serve external port: ${config.externalPort}`);
  }

  const args = ["serve"];
  if (config.background !== false) args.push("--bg");
  args.push(`--https=${config.externalPort}`);
  if (config.confirm !== false) args.push("--yes");
  if (config.path) args.push(`--set-path=${normalizePath(config.path)}`);
  args.push(`http://127.0.0.1:${config.localPort}`);
  return args;
}

export function buildServeHttpUrl(hostname: string, externalPort: number, path = "/"): string {
  if (!Number.isInteger(externalPort) || externalPort < 1 || externalPort > 65_535) {
    throw new Error(`Invalid Tailscale Serve external port: ${externalPort}`);
  }

  const normalizedHost = hostname.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!normalizedHost) throw new Error("Tailscale Serve hostname is required");
  const url = new URL(`https://${normalizedHost}`);
  if (externalPort !== 443) url.port = String(externalPort);
  url.pathname = normalizePath(path);
  return url.toString();
}

export function parseTailscaleHostname(statusJson: string): string | undefined {
  try {
    const value = JSON.parse(statusJson) as { Self?: { DNSName?: unknown } };
    const hostname = value.Self?.DNSName;
    if (typeof hostname !== "string" || !hostname.trim()) return undefined;
    return hostname.trim().replace(/\.+$/, "");
  } catch {
    return undefined;
  }
}

export function buildServeUrl(hostname: string, path = "/"): string {
  const normalizedHost = hostname.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `wss://${normalizedHost}${normalizedPath}`;
}

function normalizePath(path: string): string {
  const normalized = path.trim();
  if (!normalized || normalized === "/") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
