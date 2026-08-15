import { createServeConnection, type AgentdConnection } from "@mobile-agent/agentd-client";
import { createBrowserAgentdAuth } from "./browser-auth";

export type BrowserConnectionProfile = {
  id: string;
  name: string;
  agentdBaseUrl: string;
  serverId?: string;
  updatedAt: string;
};

const storageKey = "mobile-agent.connection-profile.v1";

export function readBrowserConnectionProfile(storage: Storage | undefined = getStorage()): BrowserConnectionProfile | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return parseProfile(value);
  } catch {
    return null;
  }
}

export function saveBrowserConnectionProfile(
  input: Pick<BrowserConnectionProfile, "name" | "agentdBaseUrl"> & Pick<Partial<BrowserConnectionProfile>, "serverId">,
  storage: Storage | undefined = getStorage(),
): BrowserConnectionProfile {
  const profile: BrowserConnectionProfile = {
    id: "default",
    name: input.name.trim() || new URL(input.agentdBaseUrl).hostname,
    agentdBaseUrl: normalizeAgentdBaseUrl(input.agentdBaseUrl),
    ...(input.serverId ? { serverId: input.serverId } : {}),
    updatedAt: new Date().toISOString(),
  };
  parseProfile(profile);
  storage?.setItem(storageKey, JSON.stringify(profile));
  return profile;
}

export function clearBrowserConnectionProfile(storage: Storage | undefined = getStorage()): void {
  storage?.removeItem(storageKey);
}

export function connectionForProfile(profile: BrowserConnectionProfile | null): AgentdConnection | undefined {
  if (!profile) return undefined;
  const connection = createServeConnection(profile.agentdBaseUrl);
  connection.auth = createBrowserAgentdAuth(connection);
  return connection;
}

export function normalizeAgentdBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("agentd URL must use https:// (http:// is allowed only for local development)");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function parseProfile(value: unknown): BrowserConnectionProfile {
  if (!value || typeof value !== "object") throw new Error("Invalid connection profile");
  const candidate = value as Record<string, unknown>;
  const agentdBaseUrl = typeof candidate.agentdBaseUrl === "string"
    ? candidate.agentdBaseUrl
    : typeof candidate.serveUrl === "string" ? candidate.serveUrl : undefined;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || !agentdBaseUrl || typeof candidate.updatedAt !== "string") {
    throw new Error("Invalid connection profile");
  }
  return {
    id: candidate.id,
    name: candidate.name,
    agentdBaseUrl: normalizeAgentdBaseUrl(agentdBaseUrl),
    ...(typeof candidate.serverId === "string" ? { serverId: candidate.serverId } : {}),
    updatedAt: candidate.updatedAt,
  };
}

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
