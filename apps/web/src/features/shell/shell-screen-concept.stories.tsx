import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AppIcon } from "../../app-icon";
import { mockPanes, mockTerminalOutputForTarget } from "../../mock/mock-data";
import { TERMINAL_FONT_FAMILY, waitForTerminalFont } from "../pane/terminal-font";
import { PaneLayoutOverlay } from "../pane-board/pane-layout-overlay-view";
import { PhoneFrame } from "../notifications/mock-shell-screen";
import { NotificationKeyframes, ToastPattern, waitingAgents, type WaitingAgent } from "../notifications/waiting-notification-patterns";

const TERMINAL_FONT_SIZE = 12;

function StableTerminal({ output }: { output: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.05,
      letterSpacing: 0,
      scrollback: 0,
      theme: { background: "#111318", foreground: "#f2f4f8" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;

    const fit = () => {
      try {
        fitAddon.fit();
      } catch {
        // The container may not be laid out yet on first mount.
      }
    };

    fit();
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    window.addEventListener("resize", fit);

    void waitForTerminalFont(TERMINAL_FONT_SIZE).then(() => {
      if (terminalRef.current === terminal) {
        fit();
        terminal.refresh(0, terminal.rows - 1);
      }
    });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", fit);
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    terminal.write(output);
  }, [output]);

  return (
    <div className="absolute inset-0" style={{ padding: "max(16px,var(--safe-area-top)) max(14px,var(--safe-area-right)) max(14px,var(--safe-area-bottom)) max(14px,var(--safe-area-left))" }}>
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}

function ShellHeader({ kind, agentId, name, waiting, running, onBack, onAddPane, onOpenMap }: {
  kind: "shell" | "agent";
  agentId: string | null;
  name: string;
  waiting: number;
  running: number;
  onBack?: () => void;
  onAddPane?: () => void;
  onOpenMap?: () => void;
}) {
  const badgeClass = kind === "shell" ? "text-[#a6d5ae] bg-[#14301b]" : "text-[#9bffa7] bg-[#12351b]";
  return (
    <header className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-[#17391f] bg-[rgb(6_13_8_/_92%)] px-[10px] backdrop-blur-[18px]">
      {onBack ? (
        <button className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-strong bg-[rgb(10_22_13_/_86%)] text-muted transition-colors hover:border-[#3d7548] hover:text-lime" type="button" aria-label="Back to session selection"><AppIcon name="arrow-left" size={16} /></button>
      ) : null}
      <span className="inline-block size-[7px] shrink-0 rounded-full bg-lime-deep shadow-[0_0_0_3px_rgb(57_214_91_/_12%)]" />
      <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-[#14301b] text-lime"><AppIcon name="terminal" size={13} /></span>
      <span className={`shrink-0 rounded-[6px] px-[6px] py-[3px] font-mono text-[0.52rem] font-extrabold ${badgeClass}`}>{kind === "shell" ? "shell" : agentId}</span>
      <strong className="min-w-0 truncate text-[0.74rem] font-bold text-[#d8f4dc]">{name}</strong>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-[rgb(10_22_13_/_86%)] px-2 text-[#81a986] transition-colors hover:border-[#3d7548] hover:text-lime" type="button" onClick={onOpenMap} title="Open tmux window map" aria-label="Open tmux window map">
          <AppIcon name="layout" size={15} />
          {waiting > 0 ? <span className="flex items-center gap-1 rounded-[4px] bg-[#221b0c] px-[5px] py-[3px] font-mono text-[0.5rem] font-bold leading-none text-amber"><span className="size-[5px] animate-pulse rounded-full bg-amber" />{waiting}</span> : null}
          {running > 0 ? <span className="flex items-center gap-1 rounded-[4px] bg-[#0b1c0f] px-[5px] py-[3px] font-mono text-[0.5rem] font-bold leading-none text-lime"><span className="size-[5px] rounded-full bg-lime-deep" />{running}</span> : null}
        </button>
        {onAddPane ? (
          <button className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-strong bg-[rgb(10_22_13_/_86%)] text-muted transition-colors hover:border-[#3d7548] hover:text-lime" type="button" aria-label="Add a pane" title="Add a pane"><AppIcon name="new-pane" size={16} /></button>
        ) : null}
      </div>
    </header>
  );
}

function paneFor(target: string) {
  return mockPanes.find((pane) => pane.tmuxPaneId === target);
}

function ShellScreenFinal({ notifications = waitingAgents }: { notifications?: WaitingAgent[] }) {
  const [currentTarget, setCurrentTarget] = useState("%2");
  const [activeNotifications, setActiveNotifications] = useState(notifications);
  const [mapOpen, setMapOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const current = paneFor(currentTarget) ?? mockPanes[0] ?? null;
  const session = current?.sessionName ?? "mobile-agent";
  const sessionPanes = mockPanes.filter((pane) => pane.sessionName === session);
  const waiting = sessionPanes.filter((pane) => pane.state === "waiting_input" || pane.state === "waiting_approval").length;
  const running = sessionPanes.filter((pane) => pane.state === "running").length;
  const output = mockTerminalOutputForTarget(currentTarget);

  useEffect(() => () => {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
  }, []);

  const showHint = (text: string) => {
    setHint(text);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHint(null), 2_000);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#020503] text-ink">
      <ShellHeader
        kind={current?.kind === "agent" ? "agent" : "shell"}
        agentId={current?.agentId ?? null}
        name={current?.name ?? "shell"}
        waiting={waiting}
        running={running}
        onBack={() => showHint("← back · tmux session selection")}
        onAddPane={() => showHint("+ add pane · new-pane flow")}
        onOpenMap={() => setMapOpen(true)}
      />
      <div className="relative min-h-0 flex-1 bg-[#111318]">
        <StableTerminal output={output} />
        {activeNotifications.length ? (
          <ToastPattern agents={activeNotifications} onOpen={(agent) => {
            setCurrentTarget(agent.target);
            setActiveNotifications((list) => list.filter((item) => item.id !== agent.id));
          }} />
        ) : null}
        {mapOpen ? (
          <PaneLayoutOverlay
            id="story-window-map"
            panes={mockPanes}
            selectedTarget={currentTarget}
            onSelect={(pane) => {
              setCurrentTarget(pane.tmuxPaneId);
              setMapOpen(false);
            }}
            onClose={() => setMapOpen(false)}
            variant="ghost"
          />
        ) : null}
      </div>
      {hint ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center">
          <span className="rounded-full border border-[#2b6036] bg-[rgb(7_16_8_/_94%)] px-3 py-1.5 font-mono text-[0.55rem] text-[#a9dfae] shadow-[0_10px_30px_rgb(0_0_0_/_45%)]">{hint}</span>
        </div>
      ) : null}
    </div>
  );
}

function LegacyShellScreen() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#020503] text-ink">
      <header className="flex h-[50px] shrink-0 items-center justify-between gap-3 border-b border-[#17391f] bg-[rgb(6_13_8_/_88%)] px-[14px] backdrop-blur-[18px]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 rotate-[-8deg] place-items-center rounded-[9px] border border-[#2c6b38] bg-[#071309] font-mono text-lg leading-none text-lime shadow-[inset_0_0_0_1px_rgb(139_255_154_/_8%),0_0_24px_rgb(57_214_91_/_12%)]">⌁</span>
          <span className="text-[0.95rem] font-bold tracking-[-0.035em]">agent<span className="text-lime-deep">.</span></span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-[7px] rounded-full border border-line-strong bg-[rgb(10_22_13_/_86%)] px-[9px] py-[6px]">
            <span className="inline-block size-[7px] rounded-full bg-lime-deep shadow-[0_0_0_3px_rgb(57_214_91_/_12%)]" />
          </div>
          <span className="grid size-[30px] place-items-center rounded-[10px] bg-lime text-[0.66rem] font-extrabold text-[#041006] shadow-[0_0_18px_rgb(139_255_154_/_18%)]">TY</span>
        </div>
      </header>
      <div className="flex min-h-[34px] shrink-0 items-center gap-[7px] border-b border-[#17391f] bg-[#071008] px-[8px] font-mono text-[0.5rem] text-[#8cb793]">
        <span className="inline-block size-[7px] shrink-0 rounded-full bg-lime-deep" />
        <span className="shrink-0 text-lime"><AppIcon name="terminal" size={14} /></span>
        <strong className="shrink-0">zsh</strong>
        <span className="text-[#3e6547]">·</span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">mobile-agent</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button className="grid size-6 min-w-6 place-items-center rounded-[7px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986]" type="button" aria-label="Open a new pane"><AppIcon name="new-pane" size={14} /></button>
          <button className="grid size-6 min-w-6 place-items-center rounded-[7px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986]" type="button" aria-label="Open window map"><AppIcon name="layout" size={14} /></button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-[#111318]">
        <StableTerminal output={mockTerminalOutputForTarget("%2")} />
      </div>
    </div>
  );
}

function CompleteShellStory() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex min-h-[var(--app-viewport-height)] flex-col items-center justify-center gap-4 p-5">
      <PhoneFrame>
        <ShellScreenFinal key={key} />
      </PhoneFrame>
      <p className="m-0 max-w-[420px] text-center font-mono text-[0.55rem] leading-[1.7] text-[#719176]">
        ← back to sessions · ▦ tmux window map (● waiting · ● running counts) · + add pane<br />
        the window map shows the live tmux layout; waiting / running are coloured inside it
      </p>
      <button className="rounded-full border border-line-strong bg-[rgb(10_22_13_/_92%)] px-4 py-2 font-mono text-[0.62rem] text-[#8cb793] transition-colors hover:text-lime" type="button" onClick={() => setKey((current) => current + 1)}>↻ Re-trigger notifications</button>
    </div>
  );
}

function CompareVerticalSpace() {
  return (
    <div className="flex min-h-[var(--app-viewport-height)] flex-wrap items-start justify-center gap-6 p-5">
      <figure className="m-0">
        <PhoneFrame><LegacyShellScreen /></PhoneFrame>
        <figcaption className="mt-2 text-center font-mono text-[0.62rem] text-[#719176]">Current · service header + terminal bar (84px chrome)</figcaption>
      </figure>
      <figure className="m-0">
        <PhoneFrame><ShellScreenFinal notifications={[]} /></PhoneFrame>
        <figcaption className="mt-2 text-center font-mono text-[0.62rem] text-[#719176]">Final · single menu header (52px chrome)</figcaption>
      </figure>
    </div>
  );
}

const meta = {
  title: "Concept/Shell screen",
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <>
        <NotificationKeyframes />
        <Story />
      </>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompleteShellScreen: Story = {
  name: "Final / complete shell screen (tap to open pane)",
  render: () => <CompleteShellStory />,
};

export const TerminalStability: Story = {
  name: "Terminal stability / fills area exactly",
  render: () => (
    <div className="grid min-h-[var(--app-viewport-height)] place-items-center p-5">
      <PhoneFrame><ShellScreenFinal notifications={[]} /></PhoneFrame>
    </div>
  ),
};

export const VerticalSpaceCompare: Story = {
  name: "Compare / vertical space before vs after",
  render: () => <CompareVerticalSpace />,
};

export const DesktopLayout: Story = {
  name: "Desktop / wide layout",
  render: () => (
    <main className="h-[var(--app-viewport-height)] min-h-[var(--app-viewport-height)] bg-[#040806] p-6">
      <ShellScreenFinal notifications={[]} />
    </main>
  ),
};
