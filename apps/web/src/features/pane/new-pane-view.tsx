import type { NewPaneAgent, NewPaneKind, NewPaneViewModel } from "./new-pane-viewmodel";
import { WorkspacePickerView } from "../workspace/workspace-picker-view";
import { workspacePickerState } from "../workspace/workspace-picker-viewmodel";

export function NewPaneView({ viewModel }: { viewModel: NewPaneViewModel }) {
  const needsWorkspace = viewModel.kind === "agent" && viewModel.placement === "window";
  const worktreeRequiresWindow = viewModel.kind === "agent" && viewModel.workspacePicker.mode === "worktree";
  const canCreate = viewModel.name.trim().length > 0
    && (!needsWorkspace || workspacePickerState(viewModel.workspacePicker).canContinue)
    && (viewModel.placement === "window" || Boolean(viewModel.targetPaneId));

  return (
    <main className="flex h-[var(--app-viewport-height)] min-h-[var(--app-viewport-height)] flex-col overflow-x-hidden overflow-y-auto bg-flow-grid bg-[length:auto,32px_32px,32px_32px,auto] text-ink">
      <header className="flex min-h-[58px] shrink-0 items-center justify-between gap-3 border-b border-[#17391f] bg-[#030a05]/72 px-7 backdrop-blur-[16px] max-[620px]:min-h-[calc(56px+var(--safe-area-top))] max-[620px]:px-[max(14px,var(--safe-area-right))] max-[620px]:pt-[var(--safe-area-top)]">
        <button className="inline-flex min-w-0 items-center gap-2 font-mono text-[0.64rem] text-[#76ad7e] transition-colors hover:text-lime" type="button" onClick={viewModel.onBack}>‹ <span className="truncate">{viewModel.session.name}</span></button>
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[0.52rem] text-[#78ae80]"><span className="size-[5px] rounded-full bg-lime-deep" /> {viewModel.terminal.name}</span>
      </header>
      <section className="mx-auto w-full max-w-[570px] flex-1 px-6 py-[52px] max-[620px]:px-[max(14px,var(--safe-area-right))] max-[620px]:pb-[calc(32px+var(--safe-area-bottom))] max-[620px]:pt-8">
        <div className="mb-[29px] max-[620px]:mb-[27px]">
          <span className="flex items-center gap-2 font-mono text-[0.58rem] font-bold tracking-[0.14em] text-lime-deep"><span className="h-px w-[19px] bg-lime-deep shadow-[0_0_9px_rgb(57_214_91_/_60%)]" /> NEW PANE</span>
          <h1 className="my-[14px] mb-[10px] text-[clamp(1.65rem,5vw,2.15rem)] font-bold leading-[1.05] tracking-[-0.06em] text-[#dbffdf] max-[620px]:mt-3 max-[620px]:text-[1.62rem]">Open a pane</h1>
          <p className="m-0 max-w-[430px] text-[0.79rem] leading-[1.55] text-[#719176] max-[620px]:text-[0.88rem]">Start a shell or an agent inside <strong className="text-[#c3f4c9]">{viewModel.session.name}</strong>. The pane remains a normal tmux pane on your host.</p>
        </div>

        <form className="flex flex-col gap-[17px]" onSubmit={(event) => { event.preventDefault(); if (canCreate) viewModel.onCreate(); }}>
          <label className="flex flex-col gap-[7px]">
            <span className="font-mono text-[0.56rem] font-bold tracking-[0.12em] text-[#6a9b72]">PANE NAME</span>
            <input className="min-h-[45px] w-full rounded-[9px] border border-[#24552e] bg-[rgb(6_20_9_/_82%)] px-[13px] font-mono text-base text-[#d8ffdc] outline-none transition-[border-color,box-shadow] placeholder:text-[#416a49] focus:border-lime-deep focus:shadow-[0_0_0_3px_rgb(57_214_91_/_12%)] max-[920px]:min-h-12" value={viewModel.name} onChange={(event) => viewModel.onNameChange(event.target.value)} placeholder="review" autoComplete="off" />
            <small className="font-mono text-[0.52rem] text-[#5d9168] max-[620px]:text-[0.72rem]">Shown in the pane board and layout map.</small>
          </label>

          <fieldset className="mt-0.5 flex flex-col gap-2 border-0 p-0">
            <legend className="font-mono text-[0.53rem] tracking-[0.1em] text-[#75a97d]">PANE TYPE</legend>
            <div className="grid grid-cols-2 gap-[7px] max-[620px]:grid-cols-1">
              <label className={`flex min-w-0 items-start gap-2 rounded-lg border border-[#1e4828] bg-[rgb(7_24_11_/_70%)] p-2.5 text-[#82b488] transition-colors max-[920px]:min-h-14 max-[920px]:p-3 ${viewModel.kind === "agent" ? "border-[#3d8b4c] bg-[rgb(13_40_19_/_82%)] shadow-[inset_3px_0_0_var(--color-lime-deep)]" : ""}`}>
                <input type="radio" name="pane-kind" checked={viewModel.kind === "agent"} onChange={() => viewModel.onKindChange("agent")} />
                <span className="flex min-w-0 flex-col gap-1"><strong className="text-[0.65rem] text-[#c3f4c9]">Agent</strong><small className="text-[0.57rem] leading-[1.4] text-[#638f6b] max-[620px]:text-[0.72rem]">Launch Codex or Claude through agent</small></span>
              </label>
              <label className={`flex min-w-0 items-start gap-2 rounded-lg border border-[#1e4828] bg-[rgb(7_24_11_/_70%)] p-2.5 text-[#82b488] transition-colors max-[920px]:min-h-14 max-[920px]:p-3 ${viewModel.kind === "shell" ? "border-[#3d8b4c] bg-[rgb(13_40_19_/_82%)] shadow-[inset_3px_0_0_var(--color-lime-deep)]" : ""}`}>
                <input type="radio" name="pane-kind" checked={viewModel.kind === "shell"} onChange={() => viewModel.onKindChange("shell")} />
                <span className="flex min-w-0 flex-col gap-1"><strong className="text-[0.65rem] text-[#c3f4c9]">Shell</strong><small className="text-[0.57rem] leading-[1.4] text-[#638f6b] max-[620px]:text-[0.72rem]">Open the host's default shell</small></span>
              </label>
            </div>
          </fieldset>

          <fieldset className="mt-0.5 flex flex-col gap-2 border-0 p-0">
            <legend className="font-mono text-[0.53rem] tracking-[0.1em] text-[#75a97d]">OPEN IN</legend>
            <div className="grid grid-cols-3 gap-[7px] max-[620px]:grid-cols-1">
              <label className={`flex min-w-0 items-start gap-2 rounded-lg border border-[#1e4828] bg-[rgb(7_24_11_/_70%)] p-2.5 text-[#82b488] transition-colors max-[920px]:min-h-14 max-[920px]:p-3 ${viewModel.placement === "window" ? "border-[#3d8b4c] bg-[rgb(13_40_19_/_82%)] shadow-[inset_3px_0_0_var(--color-lime-deep)]" : ""}`}>
                <input type="radio" name="pane-placement" checked={viewModel.placement === "window"} onChange={() => viewModel.onPlacementChange("window")} />
                <span className="flex min-w-0 flex-col gap-1"><strong className="text-[0.65rem] text-[#c3f4c9]">New window</strong><small className="text-[0.57rem] leading-[1.4] text-[#638f6b] max-[620px]:text-[0.72rem]">Keep the pane full-size in its own tmux window.</small></span>
              </label>
              <label className={`flex min-w-0 items-start gap-2 rounded-lg border border-[#1e4828] bg-[rgb(7_24_11_/_70%)] p-2.5 text-[#82b488] transition-colors max-[920px]:min-h-14 max-[920px]:p-3 ${viewModel.placement === "right" ? "border-[#3d8b4c] bg-[rgb(13_40_19_/_82%)] shadow-[inset_3px_0_0_var(--color-lime-deep)]" : ""} ${viewModel.existingPanes.length ? "" : "cursor-not-allowed opacity-38"}`}>
                <input type="radio" name="pane-placement" checked={viewModel.placement === "right"} onChange={() => viewModel.onPlacementChange("right")} disabled={!viewModel.existingPanes.length || worktreeRequiresWindow} />
                <span className="flex min-w-0 flex-col gap-1"><strong className="text-[0.65rem] text-[#c3f4c9]">Split right</strong><small className="text-[0.57rem] leading-[1.4] text-[#638f6b] max-[620px]:text-[0.72rem]">Place it beside an existing pane.</small></span>
              </label>
              <label className={`flex min-w-0 items-start gap-2 rounded-lg border border-[#1e4828] bg-[rgb(7_24_11_/_70%)] p-2.5 text-[#82b488] transition-colors max-[920px]:min-h-14 max-[920px]:p-3 ${viewModel.placement === "bottom" ? "border-[#3d8b4c] bg-[rgb(13_40_19_/_82%)] shadow-[inset_3px_0_0_var(--color-lime-deep)]" : ""} ${viewModel.existingPanes.length ? "" : "cursor-not-allowed opacity-38"}`}>
                <input type="radio" name="pane-placement" checked={viewModel.placement === "bottom"} onChange={() => viewModel.onPlacementChange("bottom")} disabled={!viewModel.existingPanes.length || worktreeRequiresWindow} />
                <span className="flex min-w-0 flex-col gap-1"><strong className="text-[0.65rem] text-[#c3f4c9]">Split below</strong><small className="text-[0.57rem] leading-[1.4] text-[#638f6b] max-[620px]:text-[0.72rem]">Place it beneath an existing pane.</small></span>
              </label>
            </div>
          </fieldset>

          {viewModel.placement !== "window" ? (
            <label className="flex flex-col gap-[7px]">
              <span className="font-mono text-[0.56rem] font-bold tracking-[0.12em] text-[#6a9b72]">SPLIT FROM</span>
              <select className="min-h-[45px] w-full rounded-[9px] border border-[#24552e] bg-[rgb(6_20_9_/_82%)] px-[13px] font-mono text-base text-[#d8ffdc] outline-none focus:border-lime-deep focus:shadow-[0_0_0_3px_rgb(57_214_91_/_12%)] max-[920px]:min-h-12" value={viewModel.targetPaneId ?? ""} onChange={(event) => viewModel.onTargetPaneChange(event.target.value)}>
                {viewModel.existingPanes.map((pane) => <option value={pane.tmuxPaneId} key={pane.id}>{pane.name} · {pane.tmuxPaneId}</option>)}
              </select>
              <small className="font-mono text-[0.52rem] text-[#5d9168] max-[620px]:text-[0.72rem]">The new pane will be created relative to this tmux pane.</small>
            </label>
          ) : null}

          {viewModel.kind === "agent" ? (
            <>
              <label className="flex flex-col gap-[7px]">
                <span className="font-mono text-[0.56rem] font-bold tracking-[0.12em] text-[#6a9b72]">AGENT</span>
                <select className="min-h-[45px] w-full rounded-[9px] border border-[#24552e] bg-[rgb(6_20_9_/_82%)] px-[13px] font-mono text-base text-[#d8ffdc] outline-none focus:border-lime-deep focus:shadow-[0_0_0_3px_rgb(57_214_91_/_12%)] max-[920px]:min-h-12" value={viewModel.agentId} onChange={(event) => viewModel.onAgentChange(event.target.value as NewPaneAgent)}>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
                </select>
              </label>
            </>
          ) : null}

          {needsWorkspace ? <WorkspacePickerView viewModel={viewModel.workspacePicker} showMode /> : null}
          {viewModel.errorMessage ? <p className="m-0 text-[0.62rem] leading-[1.45] text-[#ff9a8f]" role="alert">{viewModel.errorMessage}</p> : null}
          <button className="mt-1 flex min-h-[45px] w-full items-center justify-between gap-3 rounded-[9px] border border-[#4a9a57] bg-lime px-[15px] text-[0.71rem] font-bold text-[#061008] transition-colors hover:bg-[#b0ffb8] disabled:cursor-not-allowed disabled:opacity-35 max-[920px]:min-h-[52px] max-[920px]:text-[0.88rem]" type="submit" disabled={!canCreate || viewModel.isCreating}>{viewModel.isCreating ? "Opening pane…" : "Open pane"}<span className="text-[1.1rem]">{viewModel.isCreating ? "…" : "→"}</span></button>
        </form>
      </section>
    </main>
  );
}
