import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

type CreationKind = "agent" | "shell";
type Destination = "window" | "pane";
type Direction = "right" | "bottom";

type ConceptPane = {
  id: string;
  name: string;
  windowName: string;
};

type NewPaneCreationConceptProps = {
  initialDestination?: Destination;
  initialDirection?: Direction;
  initialKind?: CreationKind;
  currentPaneId?: string;
  initialPanes?: ConceptPane[];
};

const demoPanes: ConceptPane[] = [
  { id: "review", name: "review", windowName: "muximo" },
  { id: "build", name: "build", windowName: "muximo" },
];

const modalFieldLabelClass = "font-mono text-[0.55rem] tracking-[0.13em] text-[#79aa80]";
const modalInputClass = "min-h-[49px] w-full rounded-[9px] border border-[#2a5b35] bg-[#051009] px-3 font-mono text-[0.76rem] text-[#e0f9e2] outline-none focus:border-lime focus:shadow-[0_0_0_3px_rgb(57_214_91_/_13%)]";
const modalOptionClass = "flex min-w-0 min-h-[59px] items-center gap-[9px] rounded-[9px] border border-[#214a2b] bg-[rgb(5_21_9_/_75%)] px-2.5 py-[9px] text-left text-[#83b289] transition-[border-color,background,transform] hover:-translate-y-px hover:border-[#5aa466] hover:bg-[#0d2a14]";
const modalOptionSelectedClass = "border-lime-deep bg-[linear-gradient(135deg,#12391a,#092411)] text-[#d7f7da] shadow-[inset_3px_0_0_var(--color-lime)]";
const modalOptionContentClass = "flex min-w-0 flex-1 flex-col gap-[3px]";
const modalOptionTitleClass = "text-[0.7rem] leading-[1.2] text-[#d4f4d7]";
const modalOptionDescriptionClass = "overflow-hidden text-[0.57rem] leading-[1.3] text-[#6e9773] text-ellipsis whitespace-nowrap";
const modalIconClass = "grid size-[27px] shrink-0 place-items-center rounded-[7px] border border-[#387346] bg-[rgb(57_214_91_/_10%)] text-[0.86rem] font-extrabold text-lime";

function NewPaneCreationConcept({
  initialDestination = "pane",
  initialDirection = "right",
  initialKind = "agent",
  currentPaneId = "review",
  initialPanes = demoPanes,
}: NewPaneCreationConceptProps) {
  const currentPane = initialPanes.find((pane) => pane.id === currentPaneId) ?? initialPanes[0] ?? null;
  const canAddPane = Boolean(currentPane);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CreationKind>(initialKind);
  const [agent, setAgent] = useState<"codex" | "claude">("codex");
  const [worktree, setWorktree] = useState(true);
  const [destination, setDestination] = useState<Destination>(canAddPane ? initialDestination : "window");
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [workspace, setWorkspace] = useState("muximo");
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

  const isGitWorkspace = workspace === "muximo";
  const normalizedName = normalizePreviewName(name);
  const creatableName = kind === "agent" ? normalizedName : name.trim();

  const selectKind = (nextKind: CreationKind) => {
    setKind(nextKind);
    if (nextKind === "shell") setWorktree(false);
    if (nextKind === "agent" && isGitWorkspace) setWorktree(true);
    setCreatedMessage(null);
  };

  const selectWorkspace = (nextWorkspace: string) => {
    setWorkspace(nextWorkspace);
    setWorktree(nextWorkspace === "muximo");
    setCreatedMessage(null);
  };

  return (
    <main className="min-h-[var(--app-viewport-height)] bg-[#030804] text-ink">
      <div className="grid min-h-[var(--app-viewport-height)] place-items-center bg-black/25 p-5 max-[620px]:items-end max-[620px]:p-2">
        <section className="flex max-h-[calc(var(--app-viewport-height)-32px)] w-full max-w-[500px] flex-col overflow-hidden rounded-[19px] border border-[#2a5934] bg-[linear-gradient(145deg,#0b1a0e,#030905)] shadow-[0_28px_80px_rgb(0_0_0_/_52%),0_0_0_1px_rgb(139_255_154_/_4%)] max-[620px]:max-h-[calc(var(--app-viewport-height)-16px)] max-[620px]:rounded-[17px]" role="dialog" aria-modal="true" aria-labelledby="new-pane-modal-title">
          <header className="flex items-start justify-between gap-5 border-b border-[#193820] px-[22px] pb-[15px] pt-[18px] max-[620px]:px-[18px] max-[620px]:pb-3.5">
            <div>
              <h1 id="new-pane-modal-title" className="m-0 text-[1.65rem] leading-none tracking-[-0.055em] text-[#ddf8e0]">Add pane</h1>
            </div>
            <button className="grid size-[34px] shrink-0 place-items-center rounded-[9px] border border-[#244c2d] bg-[rgb(5_18_8_/_70%)] text-[1.25rem] leading-none text-[#83ae88] transition-colors hover:border-lime-deep hover:text-lime" type="button" aria-label="Close" onClick={() => setCreatedMessage("Close is mocked in this exploratory story.")}>×</button>
          </header>

          <div className="flex min-h-0 flex-col gap-[17px] overflow-y-auto px-[22px] pb-[21px] pt-[19px] max-[620px]:gap-[15px] max-[620px]:px-[18px] max-[620px]:pb-[18px] max-[620px]:pt-4">
            <label className="flex flex-col gap-[7px]">
              <span className="text-[0.73rem] font-bold text-[#c2edc7]">Name <em className="ml-[5px] font-mono text-[0.53rem] font-normal not-italic uppercase tracking-[0.07em] text-lime-deep">required</em></span>
              <input className={`${modalInputClass} min-h-[47px] text-[0.78rem]`} autoFocus value={name} onChange={(event) => { setName(event.target.value); setCreatedMessage(null); }} placeholder="e.g. API review" autoComplete="off" />
              {kind === "agent" && name.trim() && normalizedName !== name.trim() ? <small className="text-[0.59rem] leading-[1.35] text-[#638b69]">Worktree / session: <code className="ml-[3px] font-inherit text-[#c4efc9]">{normalizedName || "use letters or numbers"}</code></small> : null}
            </label>

            <label className="flex flex-col gap-[7px]">
              <span className={modalFieldLabelClass}>Workspace <em className="ml-[5px] font-mono text-[0.53rem] font-normal not-italic uppercase tracking-[0.07em] text-lime-deep">required</em></span>
              <select className={`${modalInputClass} min-h-[43px] text-[0.66rem]`} value={workspace} onChange={(event) => selectWorkspace(event.target.value)}>
                <option value="muximo">muximo · ~/work/muximo</option>
                <option value="scratch">scratch · ~/tmp/scratch</option>
              </select>
            </label>

            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-2 block w-full font-mono text-[0.55rem] tracking-[0.13em] text-[#79aa80]">Run</legend>
              <div className="grid grid-cols-2 gap-[7px]">
                <button className={`${modalOptionClass} ${kind === "agent" ? modalOptionSelectedClass : ""}`} type="button" aria-pressed={kind === "agent"} onClick={() => selectKind("agent")}>
                  <span className={modalIconClass} aria-hidden="true">✦</span>
                  <span className={modalOptionContentClass}><strong className={modalOptionTitleClass}>Agent</strong></span>
                  <b aria-hidden="true">{kind === "agent" ? "✓" : ""}</b>
                </button>
                <button className={`${modalOptionClass} ${kind === "shell" ? modalOptionSelectedClass : ""}`} type="button" aria-pressed={kind === "shell"} onClick={() => selectKind("shell")}>
                  <span className={`${modalIconClass} text-[0.59rem] tracking-[-0.08em]`} aria-hidden="true">&gt;_</span>
                  <span className={modalOptionContentClass}><strong className={modalOptionTitleClass}>Shell</strong></span>
                  <b aria-hidden="true">{kind === "shell" ? "✓" : ""}</b>
                </button>
              </div>
            </fieldset>

            {kind === "agent" ? (
              <div className="grid gap-[11px] border-l border-[#285b33] py-3 pl-3.5">
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-2 block w-full font-mono text-[0.55rem] tracking-[0.13em] text-[#79aa80]">Agent</legend>
                  <div className="grid grid-cols-2 gap-[7px]">
                    <button className={`${modalOptionClass} items-start justify-center px-3`} type="button" aria-pressed={agent === "codex"} onClick={() => { setAgent("codex"); setCreatedMessage(null); }}><strong className={`${modalOptionTitleClass} ${agent === "codex" ? "text-lime" : ""}`}>Codex</strong></button>
                    <button className={`${modalOptionClass} items-start justify-center px-3`} type="button" aria-pressed={agent === "claude"} onClick={() => { setAgent("claude"); setCreatedMessage(null); }}><strong className={`${modalOptionTitleClass} ${agent === "claude" ? "text-lime" : ""}`}>Claude Code</strong></button>
                  </div>
                </fieldset>
                <label className="flex cursor-pointer items-start gap-[9px] rounded-lg border border-[#1e4828] bg-[rgb(7_24_11_/_52%)] px-2.5 py-[9px]">
                  <input className="mt-0.5 accent-lime-deep" type="checkbox" checked={worktree} disabled={!isGitWorkspace} onChange={(event) => { setWorktree(event.target.checked); setCreatedMessage(null); }} />
                  <span className="flex flex-col gap-[3px]"><strong className="text-[0.63rem] text-[#c5edc9]">Use Git worktree</strong></span>
                </label>
              </div>
            ) : null}

            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-2 block w-full font-mono text-[0.55rem] tracking-[0.13em] text-[#79aa80]">Open as</legend>
              <div className="grid grid-cols-2 gap-[7px]">
                <button className={`${modalOptionClass} ${destination === "pane" ? modalOptionSelectedClass : ""}`} type="button" aria-pressed={destination === "pane"} disabled={!canAddPane} onClick={() => { setDestination("pane"); setCreatedMessage(null); }}>
                  <span className={modalIconClass} aria-hidden="true">▥</span>
                  <span className={modalOptionContentClass}><strong className={modalOptionTitleClass}>Pane</strong><small className={modalOptionDescriptionClass}>In the current window</small></span>
                  <b aria-hidden="true">{destination === "pane" ? "✓" : ""}</b>
                </button>
                <button className={`${modalOptionClass} ${destination === "window" ? modalOptionSelectedClass : ""}`} type="button" aria-pressed={destination === "window"} onClick={() => { setDestination("window"); setCreatedMessage(null); }}>
                  <span className={modalIconClass} aria-hidden="true">↗</span>
                  <span className={modalOptionContentClass}><strong className={modalOptionTitleClass}>Window</strong><small className={modalOptionDescriptionClass}>In a new tab</small></span>
                  <b aria-hidden="true">{destination === "window" ? "✓" : ""}</b>
                </button>
              </div>
            </fieldset>

            {destination === "pane" ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <div className="mb-2 flex items-baseline justify-between gap-2.5">
                  <legend className="w-auto font-mono text-[0.55rem] tracking-[0.13em] text-[#79aa80]">Direction</legend>
                  <small className="text-right text-[0.58rem] text-[#658d6b]">Current: <strong className="text-[#bdeac2]">{currentPane?.name}</strong></small>
                </div>
                <div className="grid grid-cols-2 gap-[7px]">
                  <button className={`${modalOptionClass} min-h-[52px] ${direction === "right" ? modalOptionSelectedClass : ""}`} type="button" aria-pressed={direction === "right"} onClick={() => { setDirection("right"); setCreatedMessage(null); }}>
                    <span className="flex size-[29px] shrink-0 gap-0.5 rounded-[5px] border border-[#376f42] bg-[#061008] p-1" aria-hidden="true"><i className="block flex-1 rounded-[2px] border border-[#699d70] bg-[rgb(57_214_91_/_12%)]" /><i className="block flex-1 rounded-[2px] border border-[#699d70] bg-[rgb(57_214_91_/_12%)]" /></span>
                    <span className={modalOptionContentClass}><strong className={modalOptionTitleClass}>Right</strong></span>
                  </button>
                  <button className={`${modalOptionClass} min-h-[52px] ${direction === "bottom" ? modalOptionSelectedClass : ""}`} type="button" aria-pressed={direction === "bottom"} onClick={() => { setDirection("bottom"); setCreatedMessage(null); }}>
                    <span className="flex size-[29px] shrink-0 flex-col gap-0.5 rounded-[5px] border border-[#376f42] bg-[#061008] p-1" aria-hidden="true"><i className="block flex-1 rounded-[2px] border border-[#699d70] bg-[rgb(57_214_91_/_12%)]" /><i className="block flex-1 rounded-[2px] border border-[#699d70] bg-[rgb(57_214_91_/_12%)]" /></span>
                    <span className={modalOptionContentClass}><strong className={modalOptionTitleClass}>Below</strong></span>
                  </button>
                </div>
              </fieldset>
            ) : null}

          </div>

          <footer className="grid gap-2 border-t border-[#193820] bg-[rgb(5_17_8_/_90%)] px-[22px] pb-[18px] pt-3.5 max-[620px]:px-[18px] max-[620px]:pb-[calc(14px+var(--safe-area-bottom))]">
            <button className="inline-flex min-h-12 items-center justify-between gap-4 rounded-[9px] border border-lime bg-lime px-4 pr-3.5 text-[0.72rem] font-extrabold text-[#061008] transition-colors hover:bg-[#b3ffba] disabled:cursor-not-allowed disabled:opacity-35" type="button" disabled={!creatableName} onClick={() => setCreatedMessage(`Created '${creatableName}' (mocked in this Story).`)}>
              Create pane<span className="text-base" aria-hidden="true">→</span>
            </button>
          </footer>
          {createdMessage ? <p className="m-[-8px_22px_16px] font-mono text-[0.59rem] text-lime max-[620px]:mx-[18px]" role="status">{createdMessage}</p> : null}
        </section>
      </div>
    </main>
  );
}

function normalizePreviewName(value: string): string {
  if (!value.trim()) return "";
  let normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/\.{2,}/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/\.lock$/iu, "-lock")
    .replace(/-{2,}/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  const encoder = new TextEncoder();
  let limited = "";
  let byteLength = 0;
  let codePointCount = 0;
  for (const character of normalized) {
    if (codePointCount >= 64) break;
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > 240) break;
    limited += character;
    byteLength += characterBytes;
    codePointCount += 1;
  }
  normalized = limited.replace(/^[._-]+|[._-]+$/gu, "");
  return /^[\p{L}\p{N}]/u.test(normalized) ? normalized : "";
}

const meta = {
  title: "Concept/New pane creation",
  component: NewPaneCreationConcept,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof NewPaneCreationConcept>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PaneInCurrentWindow: Story = {
  name: "Recommended / pane in current window",
  render: () => <NewPaneCreationConcept />,
};

export const NewWindow: Story = {
  name: "Alternative / new window",
  render: () => <NewPaneCreationConcept initialDestination="window" />,
};

export const ShellPane: Story = {
  name: "Shell / compact options",
  render: () => <NewPaneCreationConcept initialKind="shell" />,
};

export const NoExistingPane: Story = {
  name: "Empty session / window only",
  render: () => <NewPaneCreationConcept initialPanes={[]} />,
};
