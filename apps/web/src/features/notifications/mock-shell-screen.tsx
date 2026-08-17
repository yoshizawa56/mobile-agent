import type { ReactNode } from "react";
import { AppIcon } from "../../app-icon";

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[var(--app-viewport-height)] place-items-center bg-[#040806] p-5">
      <div className="relative w-[402px] max-w-full overflow-hidden rounded-[30px] border border-[#1c2b20] bg-[#020503] shadow-[0_40px_90px_rgb(0_0_0_/_55%),inset_0_0_0_1px_rgb(139_255_154_/_4%)]">
        <div className="overflow-hidden" style={{ height: "min(760px, calc(100dvh - 48px))" }}>{children}</div>
      </div>
    </div>
  );
}

export function MockTerminal() {
  return (
    <div className="absolute inset-0 overflow-hidden px-4 py-3 font-mono text-[11px] leading-[1.55] text-[#d8e1d9]">
      <div><span className="text-[#7ce38b]">~/work/muximo</span> <span className="text-[#596661]">(main)</span></div>
      <div className="text-[#c9e58b]">❯ git status --short</div>
      <div className="text-[#9fc7a5]">&nbsp; M apps/web/src/styles.css</div>
      <div className="text-[#9fc7a5]">&nbsp; M apps/web/src/mock/mock-data.ts</div>
      <div className="text-[#596661]">&nbsp;</div>
      <div className="text-[#c9e58b]">❯ bun run --filter @muximo/web test</div>
      <div><span className="text-[#7ce38b]">✓</span> <span className="text-[#9fc7a5]">1 test file passed</span> <span className="text-[#596661]">0.18s</span></div>
      <div className="text-[#596661]">&nbsp;</div>
      <div><span className="text-[#7ce38b]">~/work/muximo</span> <span className="text-[#c9e58b]">❯</span> <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-[#d8e1d9]" /></div>
    </div>
  );
}

export function MockShellScreen({ overlay }: { overlay?: ReactNode }) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#020503] text-ink">
      <header className="flex h-[50px] shrink-0 items-center justify-between gap-3 border-b border-[#17391f] bg-[rgb(6_13_8_/_88%)] px-[14px] backdrop-blur-[18px]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 rotate-[-8deg] place-items-center rounded-[9px] border border-[#2c6b38] bg-[#071309] font-mono text-lg leading-none text-lime shadow-[inset_0_0_0_1px_rgb(139_255_154_/_8%),0_0_24px_rgb(57_214_91_/_12%)]">⌁</span>
          <span className="text-[0.95rem] font-bold tracking-[-0.035em]">muximo<span className="text-lime-deep">.</span></span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-[7px] rounded-full border border-line-strong bg-[rgb(10_22_13_/_86%)] px-[9px] py-[6px]">
            <span className="inline-block size-[7px] rounded-full bg-lime-deep shadow-[0_0_0_3px_rgb(57_214_91_/_12%)]" />
          </div>
          <span className="grid size-[30px] place-items-center rounded-[10px] bg-lime text-[0.66rem] font-extrabold text-[#041006] shadow-[0_0_18px_rgb(139_255_154_/_18%)]">TY</span>
        </div>
      </header>

      <div className="flex min-h-[34px] shrink-0 items-center gap-[7px] border-b border-[#17391f] bg-[#071008] px-[8px] font-mono text-[0.5rem] text-[#8cb793]">
        <button className="grid size-6 min-w-6 place-items-center rounded-[7px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986]" type="button" aria-label="Back to session selection"><AppIcon name="arrow-left" size={14} /></button>
        <span className="inline-block size-[7px] shrink-0 rounded-full bg-lime-deep" />
        <span className="shrink-0 text-lime"><AppIcon name="terminal" size={14} /></span>
        <strong className="shrink-0">zsh</strong>
        <span className="text-[#3e6547]">·</span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">muximo</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button className="grid size-6 min-w-6 place-items-center rounded-[7px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986]" type="button" aria-label="Open a new pane"><AppIcon name="new-pane" size={14} /></button>
          <button className="grid size-6 min-w-6 place-items-center rounded-[7px] border border-[#1d4c29] bg-[#0b1c0f] text-[#81a986]" type="button" aria-label="Open window map"><AppIcon name="layout" size={14} /></button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#111318]">
        <MockTerminal />
        {overlay}
      </div>
    </div>
  );
}
