import { useState } from "react";
import { connectionForProfile, readBrowserConnectionProfile, type BrowserConnectionProfile } from "./connection-profile-store";
import type { MuximodConnection } from "./muximod-client";

export type MuximodConnectionState = {
  profile: BrowserConnectionProfile | null;
  connection: MuximodConnection | undefined;
  connectionKey: string;
};

export function useMuximodConnection(): MuximodConnectionState {
  const [profile] = useState<BrowserConnectionProfile | null>(() => readBrowserConnectionProfile());
  const [connection] = useState<MuximodConnection | undefined>(() => connectionForProfile(profile));

  return {
    profile,
    connection,
    connectionKey: muximodConnectionKey(connection),
  };
}

export function muximodConnectionKey(connection: MuximodConnection | undefined): string {
  return connection ? `${connection.route ?? "custom"}:${connection.httpBaseUrl}` : "unconfigured";
}
