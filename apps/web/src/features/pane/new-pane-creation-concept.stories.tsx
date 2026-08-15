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
  { id: "review", name: "review", windowName: "mobile-agent" },
  { id: "build", name: "build", windowName: "mobile-agent" },
];

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
  const [workspace, setWorkspace] = useState("mobile-agent");
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

  const isGitWorkspace = workspace === "mobile-agent";
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
    setWorktree(nextWorkspace === "mobile-agent");
    setCreatedMessage(null);
  };

  return (
    <main className="new-pane-modal-story">
      <div className="new-pane-modal-backdrop">
        <section className="new-pane-modal" role="dialog" aria-modal="true" aria-labelledby="new-pane-modal-title">
          <header className="new-pane-modal-header">
            <div>
              <h1 id="new-pane-modal-title">Add pane</h1>
            </div>
            <button className="new-pane-modal-close" type="button" aria-label="Close" onClick={() => setCreatedMessage("Close is mocked in this exploratory story.")}>×</button>
          </header>

          <div className="new-pane-modal-body">
            <label className="new-pane-modal-name-field">
              <span>Name <em>required</em></span>
              <input autoFocus value={name} onChange={(event) => { setName(event.target.value); setCreatedMessage(null); }} placeholder="e.g. API review" autoComplete="off" />
              {kind === "agent" && name.trim() && normalizedName !== name.trim() ? <small>Worktree / session: <code>{normalizedName || "use letters or numbers"}</code></small> : null}
            </label>

            <label className="new-pane-modal-workspace-field">
              <span>Workspace <em>required</em></span>
              <select value={workspace} onChange={(event) => selectWorkspace(event.target.value)}>
                <option value="mobile-agent">mobile-agent · ~/work/mobile-agent</option>
                <option value="scratch">scratch · ~/tmp/scratch</option>
              </select>
            </label>

            <fieldset className="new-pane-modal-fieldset">
              <legend>Run</legend>
              <div className="new-pane-modal-choice-grid">
                <button className={`new-pane-modal-choice${kind === "agent" ? " new-pane-modal-choice-selected" : ""}`} type="button" aria-pressed={kind === "agent"} onClick={() => selectKind("agent")}>
                  <span className="new-pane-modal-choice-icon" aria-hidden="true">✦</span>
                  <span><strong>Agent</strong></span>
                  <b aria-hidden="true">{kind === "agent" ? "✓" : ""}</b>
                </button>
                <button className={`new-pane-modal-choice${kind === "shell" ? " new-pane-modal-choice-selected" : ""}`} type="button" aria-pressed={kind === "shell"} onClick={() => selectKind("shell")}>
                  <span className="new-pane-modal-choice-icon new-pane-modal-choice-icon-shell" aria-hidden="true">&gt;_</span>
                  <span><strong>Shell</strong></span>
                  <b aria-hidden="true">{kind === "shell" ? "✓" : ""}</b>
                </button>
              </div>
            </fieldset>

            {kind === "agent" ? (
              <div className="new-pane-modal-agent-options">
                <fieldset className="new-pane-modal-fieldset">
                  <legend>Agent</legend>
                  <div className="new-pane-modal-runtime-grid">
                    <button className={`new-pane-modal-runtime${agent === "codex" ? " new-pane-modal-runtime-selected" : ""}`} type="button" aria-pressed={agent === "codex"} onClick={() => { setAgent("codex"); setCreatedMessage(null); }}><strong>Codex</strong></button>
                    <button className={`new-pane-modal-runtime${agent === "claude" ? " new-pane-modal-runtime-selected" : ""}`} type="button" aria-pressed={agent === "claude"} onClick={() => { setAgent("claude"); setCreatedMessage(null); }}><strong>Claude Code</strong></button>
                  </div>
                </fieldset>
                <label className="new-pane-modal-toggle">
                  <input type="checkbox" checked={worktree} disabled={!isGitWorkspace} onChange={(event) => { setWorktree(event.target.checked); setCreatedMessage(null); }} />
                  <span><strong>Use Git worktree</strong></span>
                </label>
              </div>
            ) : null}

            <fieldset className="new-pane-modal-fieldset">
              <legend>Open as</legend>
              <div className="new-pane-modal-destination-grid">
                <button className={`new-pane-modal-destination${destination === "pane" ? " new-pane-modal-destination-selected" : ""}${canAddPane ? "" : " new-pane-modal-destination-disabled"}`} type="button" aria-pressed={destination === "pane"} disabled={!canAddPane} onClick={() => { setDestination("pane"); setCreatedMessage(null); }}>
                  <span className="new-pane-modal-destination-icon" aria-hidden="true">▥</span>
                  <span><strong>Pane</strong><small>In the current window</small></span>
                  <b aria-hidden="true">{destination === "pane" ? "✓" : ""}</b>
                </button>
                <button className={`new-pane-modal-destination${destination === "window" ? " new-pane-modal-destination-selected" : ""}`} type="button" aria-pressed={destination === "window"} onClick={() => { setDestination("window"); setCreatedMessage(null); }}>
                  <span className="new-pane-modal-destination-icon" aria-hidden="true">↗</span>
                  <span><strong>Window</strong><small>In a new tab</small></span>
                  <b aria-hidden="true">{destination === "window" ? "✓" : ""}</b>
                </button>
              </div>
            </fieldset>

            {destination === "pane" ? (
              <fieldset className="new-pane-modal-fieldset">
                <div className="new-pane-modal-legend-row">
                  <legend>Direction</legend>
                  <small>Current: <strong>{currentPane?.name}</strong></small>
                </div>
                <div className="new-pane-modal-direction-grid">
                  <button className={`new-pane-modal-direction${direction === "right" ? " new-pane-modal-direction-selected" : ""}`} type="button" aria-pressed={direction === "right"} onClick={() => { setDirection("right"); setCreatedMessage(null); }}>
                    <span className="new-pane-modal-direction-diagram new-pane-modal-direction-diagram-right" aria-hidden="true"><i /><i /></span>
                    <span><strong>Right</strong></span>
                  </button>
                  <button className={`new-pane-modal-direction${direction === "bottom" ? " new-pane-modal-direction-selected" : ""}`} type="button" aria-pressed={direction === "bottom"} onClick={() => { setDirection("bottom"); setCreatedMessage(null); }}>
                    <span className="new-pane-modal-direction-diagram new-pane-modal-direction-diagram-bottom" aria-hidden="true"><i /><i /></span>
                    <span><strong>Below</strong></span>
                  </button>
                </div>
              </fieldset>
            ) : null}

          </div>

          <footer className="new-pane-modal-footer">
            <button className="new-pane-modal-primary" type="button" disabled={!creatableName} onClick={() => setCreatedMessage(`Created '${creatableName}' (mocked in this Story).`)}>
              Create pane<span aria-hidden="true">→</span>
            </button>
          </footer>
          {createdMessage ? <p className="new-pane-modal-created" role="status">{createdMessage}</p> : null}
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
