import type { TerminalEndpoint, TmuxSession } from "./connection-flow-viewmodel";

export const mockTerminals: TerminalEndpoint[] = [
  {
    id: "macbook-air",
    name: "MacBook Air",
    host: "toru-macbook-air",
    tailnetIp: "100.112.247.15",
    state: "online",
    detail: "agentd 0.1 · macOS",
    lastSeen: "active now",
  },
  {
    id: "studio-mini",
    name: "Studio Mac mini",
    host: "studio-mini",
    tailnetIp: "100.112.247.42",
    state: "offline",
    detail: "agentd 0.1 · macOS",
    lastSeen: "last seen 2h ago",
  },
];

export const mockSessions: TmuxSession[] = [
  {
    name: "mobile-agent",
    workspace: "mobile-agent",
    cwd: "~/work/mobile-agent",
    paneCount: 4,
    waitingCount: 1,
    detail: "2 agents · 1 shell · waiting input",
    state: "active",
  },
  {
    name: "papercal",
    workspace: "papercal",
    cwd: "~/work/papercal",
    paneCount: 2,
    waitingCount: 1,
    detail: "1 agent · approval waiting",
    state: "active",
  },
  {
    name: "scratch",
    workspace: "scratch",
    cwd: "~/tmp/scratch",
    paneCount: 1,
    waitingCount: 0,
    detail: "idle shell",
    state: "idle",
  },
];
