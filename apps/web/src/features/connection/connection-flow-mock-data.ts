import type { TerminalEndpoint, TmuxSession } from "./connection-flow-viewmodel";

export const mockTerminals: TerminalEndpoint[] = [
  {
    id: "macbook-air",
    name: "MacBook Air",
    host: "toru-macbook-air",
    tailnetIp: "100.112.247.15",
    state: "online",
    detail: "muximod 0.1 · macOS",
    lastSeen: "active now",
  },
  {
    id: "studio-mini",
    name: "Studio Mac mini",
    host: "studio-mini",
    tailnetIp: "100.112.247.42",
    state: "offline",
    detail: "muximod 0.1 · macOS",
    lastSeen: "last seen 2h ago",
  },
];

export const mockSessions: TmuxSession[] = [
  {
    name: "muximo",
    paneCount: 4,
    waitingCount: 1,
    detail: "2 agents · 1 shell · waiting input",
  },
  {
    name: "papercal",
    paneCount: 2,
    waitingCount: 1,
    detail: "1 agent · approval waiting",
  },
  {
    name: "scratch",
    paneCount: 1,
    waitingCount: 0,
    detail: "idle shell",
  },
];
