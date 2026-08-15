import type { PaneViewModel } from "./pane-viewmodel";
import { PaneBoardView } from "../pane-board/pane-board-view";
import type { PaneBoardViewModel } from "../pane-board/pane-board-viewmodel";
import type { PaneLayoutOverlayVariant } from "../pane-board/pane-layout-overlay-view";
import { useWindowMapGesture } from "./window-map-gesture";

export function PaneView({ viewModel, paneBoard, layoutVariant = "ghost", onWorkspaceSwitch, onNewPane }: { viewModel: PaneViewModel; paneBoard: PaneBoardViewModel; layoutVariant?: PaneLayoutOverlayVariant; onWorkspaceSwitch?: () => void; onNewPane?: () => void }) {
  const windowMapSurfaceRef = useWindowMapGesture(paneBoard.open);
  const selectedPane = paneBoard.panes.find((pane) => pane.tmuxPaneId === viewModel.target);
  const title = selectedPane?.name ?? viewModel.target;
  const agentName = selectedPane?.agentId ?? (selectedPane?.kind === "shell" ? "shell" : "agent");
  const sessionName = selectedPane?.sessionName ?? "mobile-agent";
  const cwd = selectedPane?.cwd ?? "~/work/mobile-agent";
  const shellMode = selectedPane?.kind === "shell";
  const waitingCount = paneBoard.panes.filter((pane) => pane.state === "waiting_input" || pane.state === "waiting_approval").length;
  const connectionDotClass = viewModel.status === "connected"
    ? "bg-lime-deep shadow-[0_0_0_3px_rgb(57_214_91_/_12%)]"
    : viewModel.status === "connecting" ? "bg-amber" : "bg-red";
  const agentBadgeClass = selectedPane?.kind === "shell" ? "text-[#a6d5ae] bg-[#14301b]" : "text-[#9bffa7] bg-[#12351b]";
  const ownerPillClass = viewModel.viewportOwner === "desktop"
    ? "border-[#735c2c] text-amber bg-[#231b0b]"
    : "border-[#2b6838] text-lime bg-[#0b2110] shadow-[0_0_20px_rgb(57_214_91_/_9%)]";
  const selectionActionClass = viewModel.selectionMode ? "border-lime bg-lime text-[#061008]" : "";

  return (
    <main ref={windowMapSurfaceRef} className="flex h-[var(--app-viewport-height)] min-h-[var(--app-viewport-height)] flex-col overflow-hidden text-ink [touch-action:pan-x_pan-y]">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-line bg-[rgb(6_13_8_/_88%)] px-8 backdrop-blur-[18px] max-[920px]:h-16 max-[920px]:px-[18px] max-[620px]:h-[50px] max-[620px]:px-[14px]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 rotate-[-8deg] place-items-center rounded-[9px] border border-[#2c6b38] bg-[#071309] font-mono text-lg leading-none text-lime shadow-[inset_0_0_0_1px_rgb(139_255_154_/_8%),0_0_24px_rgb(57_214_91_/_12%)]">⌁</span>
          <span className="text-base font-bold tracking-[-0.035em]">agent<span className="text-lime-deep">.</span></span>
          <span className="ml-0.5 border-l border-line-strong pl-3 text-[0.72rem] tracking-[0.04em] text-muted max-[920px]:hidden">control room</span>
        </div>
        <div className="flex items-center gap-3 max-[620px]:gap-[7px]">
          <div className="flex items-center gap-[7px] rounded-full border border-line-strong bg-[rgb(10_22_13_/_86%)] px-[11px] py-[7px] font-mono text-[0.66rem] tracking-[-0.02em] text-[#91b999]">
            <span className={`inline-block size-[7px] shrink-0 rounded-full ${connectionDotClass}`} />
            <span className="max-[920px]:hidden">{viewModel.status === "connected" ? "Tailnet connected" : viewModel.status}</span>
          </div>
          <button className="grid size-8 place-items-center rounded-[10px] border border-line-strong bg-[rgb(10_22_13_/_86%)] text-[0.8rem] text-muted transition-colors hover:border-[#3d7548] hover:bg-[#102417] hover:text-lime max-[620px]:hidden" type="button" aria-label="Settings">⌘</button>
          <span className="grid size-[30px] place-items-center rounded-[10px] bg-lime text-[0.66rem] font-extrabold text-[#041006] shadow-[0_0_18px_rgb(139_255_154_/_18%)]">TY</span>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1560px] flex-1 min-h-0 grid-cols-[196px_minmax(0,1fr)_316px] gap-7 overflow-hidden p-[28px_32px_32px] max-[1180px]:grid-cols-[170px_minmax(0,1fr)_286px] max-[1180px]:gap-[18px] max-[1180px]:px-[22px] max-[920px]:block max-[920px]:h-full max-[920px]:p-0">
        <aside className="flex min-h-[calc(var(--app-viewport-height)-132px)] flex-col px-0 py-1.5 max-[920px]:hidden">
          <div className="pb-6">
            <div className="flex items-center gap-[7px] font-mono text-[0.62rem] font-bold leading-none tracking-[0.13em] text-muted">WORKSPACE</div>
            <div className="relative mt-[13px] flex items-center gap-2.5 rounded-xl border border-line bg-[rgb(10_22_13_/_72%)] px-2.5 py-3">
              <span className="grid size-7 place-items-center rounded-lg bg-[#12301a] text-[0.9rem] text-lime">⌂</span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <strong className="overflow-hidden text-[0.75rem] text-ellipsis whitespace-nowrap">{sessionName}</strong>
                <small className="overflow-hidden text-[0.65rem] leading-[1.45] text-muted text-ellipsis whitespace-nowrap">{cwd}</small>
              </span>
              <span className="size-[5px] shrink-0 rounded-full bg-lime-deep shadow-[0_0_0_3px_rgb(57_214_91_/_12%)]" />
            </div>
          </div>

          <div className="border-t border-line pb-6 pt-[22px]">
            <div className="flex items-center justify-between"><span className="flex items-center gap-[7px] font-mono text-[0.62rem] font-bold leading-none tracking-[0.13em] text-muted">ATTENTION</span><span className="grid min-w-[19px] size-[19px] place-items-center rounded-full bg-amber font-mono text-[0.62rem] font-extrabold text-[#0b170c]">{waitingCount}</span></div>
            <div className="mt-3.5 flex items-center gap-2.5">
              <span className="grid size-[27px] place-items-center rounded-lg bg-amber font-extrabold text-[#0b170c]">!</span>
              <span className="flex flex-col gap-[3px]"><strong className="text-[0.7rem] text-[#b9dfbd]">{waitingCount ? "Agents need you" : "All caught up"}</strong><small className="text-[0.65rem] leading-[1.45] text-muted">{waitingCount ? "Input or approval is waiting" : "No pending actions"}</small></span>
            </div>
          </div>

          <div className="flex-1" />
          <div className="mb-3">
            <div className="flex items-center gap-[7px] font-mono text-[0.62rem] font-bold leading-none tracking-[0.13em] text-muted">SESSION MODE</div>
            <div className="mt-[13px] flex items-center gap-2 text-[0.68rem] font-semibold text-[#b9dfbd]"><span className="text-[0.8rem] text-lime">◉</span><span>Shared tmux viewport</span></div>
            <p className="m-0 mt-[9px] text-[0.65rem] leading-[1.45] text-muted">Mobile owns the viewport while you are here. PC activity hands it back automatically.</p>
          </div>
          <div className="flex items-center gap-[7px] border-t border-line pt-[15px] font-mono text-[0.62rem] text-[#596059]"><span className="size-[5px] rounded-full bg-lime-deep" /> agentd <span className="ml-auto text-faint">v0.1</span></div>
        </aside>

        <section className="flex min-w-0 min-h-0 flex-col gap-5 max-[920px]:min-h-[var(--app-viewport-height)] max-[920px]:gap-0 max-[620px]:gap-[7px]">
          <div className="flex min-h-[74px] items-start justify-between gap-5 max-[920px]:hidden">
            <div className="min-w-0">
              <div className="flex items-center gap-[7px] font-mono text-[0.62rem] font-bold leading-none tracking-[0.13em] text-muted"><span className="size-1.5 rounded-full bg-lime-deep shadow-[0_0_0_3px_rgb(57_214_91_/_12%)]" /> LIVE SESSION</div>
              <h1 className="mb-[9px] mt-[10px] max-w-[650px] text-[clamp(1.25rem,2.2vw,1.85rem)] font-bold leading-[1.05] tracking-[-0.055em] text-ink">{title}</h1>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[0.65rem] text-muted">
                <span className={`rounded-md px-[7px] py-1 text-[0.61rem] font-extrabold uppercase tracking-[0.02em] ${agentBadgeClass}`}>{agentName}</span>
                <span>{cwd}</span>
                <span className="text-line-strong">·</span>
                <span className="max-[620px]:hidden">{viewModel.target}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
              <div className={`flex items-center gap-[7px] rounded-full border px-2.5 py-2 text-[0.67rem] font-bold ${ownerPillClass}`}>
                <span className={`size-1.5 rounded-full ${viewModel.viewportOwner === "desktop" ? "bg-amber" : "bg-lime-deep"}`} />
                {viewModel.viewportOwner === "mobile" ? "You have control" : "PC has control"}
              </div>
              <span className="font-mono text-[0.6rem] text-faint">live / just now</span>
            </div>
          </div>

          <section className="relative flex min-h-[450px] flex-1 flex-col overflow-hidden rounded-[15px] border border-[#1d4c29] bg-terminal shadow-[var(--shadow-app),0_0_0_7px_rgb(57_214_91_/_5%),0_0_70px_rgb(21_116_42_/_12%)] max-[920px]:h-[var(--app-viewport-height)] max-[920px]:min-h-0 max-[920px]:rounded-none max-[920px]:border-0 max-[920px]:shadow-none max-[620px]:h-[var(--app-viewport-height)] max-[620px]:rounded-[9px]" aria-label={`${viewModel.target} terminal`}>
            <div className="flex min-h-[45px] shrink-0 items-center justify-between gap-3 border-b border-[#15351d] bg-[#071008] px-3.5 font-mono text-[0.63rem] text-[#8cb793] max-[920px]:min-h-[calc(44px+var(--safe-area-top))] max-[920px]:gap-[5px] max-[920px]:border-b-[#17391f] max-[920px]:px-[max(8px,var(--safe-area-left))] max-[920px]:pb-0 max-[920px]:pl-[max(8px,var(--safe-area-left))] max-[920px]:pr-[max(8px,var(--safe-area-right))] max-[620px]:min-h-[34px] max-[620px]:gap-[7px] max-[620px]:px-2 max-[620px]:text-[0.5rem]">
              <div className="flex min-w-0 flex-1 items-center justify-start gap-[7px] max-[620px]:gap-[5px]">
                <span className={`inline-block size-[7px] shrink-0 rounded-full ${connectionDotClass}`} />
                <span className="text-lime">⌁</span>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap">{shellMode ? "zsh" : agentName}</strong>
                <span className="text-[#3e6547]">·</span>
                <span className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">{sessionName}</span>
                <span className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-[#3e6547] max-[620px]:hidden">{cwd}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 max-[920px]:gap-0">
                <span className="text-[0.58rem] text-[#3e6547] max-[920px]:hidden">{viewModel.target}</span>
                <span className="text-[0.58rem] text-[#3e6547] max-[920px]:hidden">80 × 24</span>
                {onNewPane ? <button className="grid size-[27px] place-items-center rounded-[10px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986] transition-colors hover:border-[#3d7548] hover:bg-[#102417] hover:text-lime max-[920px]:size-11 max-[920px]:min-w-11 max-[920px]:rounded-lg max-[920px]:text-base max-[620px]:size-6 max-[620px]:min-w-6 max-[620px]:text-[0.55rem]" type="button" onClick={onNewPane} aria-label="Open a new pane" title="Open a new pane">＋</button> : null}
                {onWorkspaceSwitch ? <button className="grid size-[27px] place-items-center rounded-[10px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986] transition-colors hover:border-[#3d7548] hover:bg-[#102417] hover:text-lime max-[920px]:size-11 max-[920px]:min-w-11 max-[920px]:rounded-lg max-[920px]:text-base max-[620px]:size-6 max-[620px]:min-w-6 max-[620px]:text-[0.55rem]" type="button" onClick={onWorkspaceSwitch} aria-label="Open workspace switcher">☰</button> : null}
                <button className={`grid size-[27px] place-items-center rounded-[10px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986] transition-colors hover:border-[#3d7548] hover:bg-[#102417] hover:text-lime max-[920px]:size-11 max-[920px]:min-w-11 max-[920px]:rounded-lg max-[920px]:text-base max-[620px]:size-6 max-[620px]:min-w-6 max-[620px]:text-[0.55rem] ${selectionActionClass}`} type="button" onClick={viewModel.selectionMode ? viewModel.exitSelectionMode : viewModel.enterSelectionMode} aria-pressed={viewModel.selectionMode} aria-label={viewModel.selectionMode ? "Exit terminal selection mode" : "Select terminal text"} title={viewModel.selectionMode ? "Exit selection mode" : "Select terminal text"}>⌗</button>
                <button className="grid size-[27px] place-items-center rounded-[10px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986] transition-colors hover:border-[#3d7548] hover:bg-[#102417] hover:text-lime max-[920px]:size-11 max-[920px]:min-w-11 max-[920px]:rounded-lg max-[920px]:text-base max-[620px]:size-6 max-[620px]:min-w-6 max-[620px]:text-[0.55rem]" type="button" onClick={paneBoard.toggle} aria-expanded={paneBoard.isOpen} aria-controls="tmux-window-map" aria-label={paneBoard.isOpen ? "Close tmux window map" : "Open tmux window map"}>⌄</button>
              </div>
            </div>
            {viewModel.selectionMode || viewModel.hasSelection || viewModel.selectionNotice ? (
              <div className="absolute inset-x-0 top-[45px] z-20 flex min-h-[42px] items-center gap-2.5 border-b border-[#15351d] bg-[#0a160d] px-2.5 py-[5px] text-[#a8c8ad] shadow-[0_12px_24px_rgb(0_0_0_/_28%)] max-[920px]:top-[calc(44px+var(--safe-area-top))] max-[920px]:min-h-12 max-[920px]:px-[max(8px,var(--safe-area-left))] max-[920px]:pr-[max(8px,var(--safe-area-right))] max-[920px]:pl-[max(8px,var(--safe-area-left))] max-[620px]:items-stretch max-[620px]:flex-col max-[620px]:gap-[3px] max-[620px]:py-[5px]" role="toolbar" aria-label="Terminal text selection">
                <span className="min-w-0 flex-1 overflow-hidden font-mono text-[0.62rem] text-[#8cb793] text-ellipsis whitespace-nowrap max-[620px]:flex-none max-[620px]:text-[0.58rem]" role="status" aria-live="polite">{viewModel.selectionNotice ?? (viewModel.selectionMode ? "Drag to select a range" : "Selection active")}</span>
                <div className="flex shrink-0 gap-1.5 overflow-x-auto max-[620px]:grid max-[620px]:grid-cols-4 max-[620px]:gap-1 max-[620px]:overflow-visible">
                  <button className="min-h-8 whitespace-nowrap rounded-lg border border-[#286039] bg-[#102417] px-2.5 text-[0.66rem] font-bold text-[#baf5c1] transition-colors hover:border-lime hover:bg-lime hover:text-[#061008] disabled:cursor-not-allowed disabled:opacity-40 max-[920px]:min-h-10 max-[920px]:px-3 max-[620px]:min-w-0 max-[620px]:px-1 max-[620px]:text-[0.62rem]" type="button" onClick={() => void viewModel.copySelection()} disabled={!viewModel.hasSelection}>Copy</button>
                  <button className="min-h-8 whitespace-nowrap rounded-lg border border-[#286039] bg-[#102417] px-2.5 text-[0.66rem] font-bold text-[#baf5c1] transition-colors hover:border-lime hover:bg-lime hover:text-[#061008] disabled:cursor-not-allowed disabled:opacity-40 max-[920px]:min-h-10 max-[920px]:px-3 max-[620px]:min-w-0 max-[620px]:px-1 max-[620px]:text-[0.62rem]" type="button" onClick={viewModel.selectAll}>Select all</button>
                  <button className="min-h-8 whitespace-nowrap rounded-lg border border-[#286039] bg-[#102417] px-2.5 text-[0.66rem] font-bold text-[#baf5c1] transition-colors hover:border-lime hover:bg-lime hover:text-[#061008] disabled:cursor-not-allowed disabled:opacity-40 max-[920px]:min-h-10 max-[920px]:px-3 max-[620px]:min-w-0 max-[620px]:px-1 max-[620px]:text-[0.62rem]" type="button" onClick={() => void viewModel.pasteFromClipboard()}>Paste</button>
                  <button className="min-h-8 whitespace-nowrap rounded-lg border border-[#1d4c29] bg-transparent px-2.5 text-[0.66rem] font-bold text-[#81a986] transition-colors hover:border-lime hover:bg-lime hover:text-[#061008] disabled:cursor-not-allowed disabled:opacity-40 max-[920px]:min-h-10 max-[920px]:px-3 max-[620px]:min-w-0 max-[620px]:px-1 max-[620px]:text-[0.62rem]" type="button" onClick={viewModel.clearSelection}>Clear</button>
                </div>
              </div>
            ) : null}
            <div ref={viewModel.terminalContainerRef} className="terminal-container flex min-h-0 w-full flex-1 touch-none bg-[#111318] px-6 pb-[18px] pt-[23px] [-webkit-touch-callout:none] max-[920px]:pb-[max(8px,var(--safe-area-bottom))] max-[620px]:px-1.5 max-[620px]:pb-[max(8px,var(--safe-area-bottom))] max-[620px]:pt-[5px]" />
            <div className="flex min-h-7 shrink-0 items-center justify-between gap-3 border-t border-[#15351d] bg-[#071008] px-[13px] font-mono text-[0.58rem] text-[#657169] max-[920px]:hidden">
              <span className="inline-flex items-center gap-1.5 text-[#8cb793]"><span className="size-[5px] rounded-full bg-lime-deep" /> {viewModel.status === "connected" ? "streaming" : viewModel.status}</span>
              <span>{viewModel.viewportReason ? `viewport · ${viewModel.viewportReason}` : "xterm / tmux"}</span>
              <span>UTF-8</span>
            </div>
          </section>

          {viewModel.errorMessage ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4 rounded-[11px] border border-[#6b302c] bg-[#26100e] px-[13px] py-2.5 max-[620px]:items-start" role="alert">
              <span className="flex min-w-0 flex-col gap-[3px]"><strong className="text-[0.7rem]">Connection interrupted</strong><small className="text-[0.65rem] text-muted">{viewModel.errorMessage}</small></span>
              <button className="whitespace-nowrap rounded-[7px] bg-lime px-2.5 py-[7px] text-[0.65rem] font-bold text-[#061008]" type="button" onClick={viewModel.reconnect}>Reconnect</button>
            </div>
          ) : null}
          {viewModel.viewportOwner === "desktop" && viewModel.status === "connected" ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4 rounded-[11px] border border-[#735c2c] bg-[#241c0d] px-[13px] py-2.5 max-[620px]:items-start" role="status">
              <span className="flex min-w-0 flex-col gap-[3px]"><strong className="text-[0.7rem]">PC activity detected</strong><small className="text-[0.65rem] text-muted">The viewport is back at desktop size.</small></span>
              <button className="whitespace-nowrap rounded-[7px] bg-[#735c2c] px-2.5 py-[7px] text-[0.65rem] font-bold text-[#fff4cf]" type="button" onClick={viewModel.claim}>Take control</button>
            </div>
          ) : null}
        </section>

        <aside className="min-w-0 min-h-0 max-[920px]:fixed max-[920px]:inset-0 max-[920px]:z-20 max-[920px]:pointer-events-none">
          <div className="h-full max-[920px]:pointer-events-none">
            <PaneBoardView viewModel={paneBoard} alwaysOpen showLayout={paneBoard.isOpen} layoutVariant={layoutVariant} />
          </div>
        </aside>
      </div>
    </main>
  );
}
