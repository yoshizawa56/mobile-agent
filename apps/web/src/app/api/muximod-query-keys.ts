import type { MuximodConnection } from "./muximod-client";

export function paneQueryKey(connection: MuximodConnection | undefined, sessionName?: string): readonly [string, string, string] {
  return ["panes", connection?.httpBaseUrl ?? "unconfigured", sessionName ?? "all"];
}
