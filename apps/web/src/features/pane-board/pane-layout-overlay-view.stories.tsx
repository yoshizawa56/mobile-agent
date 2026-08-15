import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PaneSummary } from "@mobile-agent/protocol";
import { useState } from "react";
import { PaneLayoutOverlay } from "./pane-layout-overlay-view";

const basePane: PaneSummary = {
  id: "pane-status-demo",
  tmuxPaneId: "%0",
  sessionName: "status-demo",
  windowId: "@0",
  paneIndex: 0,
  kind: "agent",
  name: "Agent status",
  cwd: "~/work/mobile-agent",
  workspaceId: "mobile-agent",
  agentId: "codex",
  runId: "run-status-demo",
  state: "running",
  title: "codex · status demo",
  lastSeenAt: "2026-08-15T00:00:00.000Z",
  windowName: "status showcase",
  windowIndex: 0,
  left: 0,
  top: 0,
  width: 80,
  height: 24,
  windowWidth: 160,
  windowHeight: 48,
};

const statusPanes: PaneSummary[] = [
  {
    ...basePane,
    id: "pane-running",
    tmuxPaneId: "%0",
    paneIndex: 0,
    name: "Implement status monitor",
    runId: "run-running",
    state: "running",
    recentOutput: "Running provider checks...\nWaiting for the next structured event",
    left: 0,
    top: 0,
  },
  {
    ...basePane,
    id: "pane-waiting-input",
    tmuxPaneId: "%1",
    paneIndex: 1,
    name: "Review the result",
    runId: "run-waiting-input",
    state: "waiting_input",
    recentOutput: "Task complete.\nContinue with the next task? ▌",
    left: 80,
    top: 0,
  },
  {
    ...basePane,
    id: "pane-waiting-approval",
    tmuxPaneId: "%2",
    paneIndex: 2,
    name: "Apply the migration",
    runId: "run-waiting-approval",
    state: "waiting_approval",
    recentOutput: "Proposed database changes are ready.\nApply this migration? ▌",
    left: 0,
    top: 24,
  },
  {
    ...basePane,
    id: "pane-failed",
    tmuxPaneId: "%3",
    paneIndex: 3,
    name: "Run the test suite",
    runId: "run-failed",
    state: "failed",
    recentOutput: "Command failed: bun test\nExit code: 1",
    left: 80,
    top: 24,
  },
];

function PaneStatusShowcase() {
  const [selectedTarget, setSelectedTarget] = useState("%0");

  return (
    <main style={{ boxSizing: "border-box", height: "100vh", minHeight: "620px", padding: "24px", background: "#030704" }}>
      <div style={{ height: "100%", maxWidth: "1100px", margin: "0 auto" }}>
        <PaneLayoutOverlay
          panes={statusPanes}
          selectedTarget={selectedTarget}
          onSelect={(pane) => setSelectedTarget(pane.tmuxPaneId)}
        />
      </div>
    </main>
  );
}

const meta = {
  title: "Pane board/Pane layout overlay",
  component: PaneLayoutOverlay,
  args: {
    panes: statusPanes,
    selectedTarget: "%0",
    onSelect: () => undefined,
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PaneLayoutOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StatusColorsAndRecentOutput: Story = {
  name: "Status colors and recent output",
  render: () => <PaneStatusShowcase />,
};
