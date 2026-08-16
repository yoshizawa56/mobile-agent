import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockShellScreen, PhoneFrame } from "./mock-shell-screen";
import { BannerPattern, DockPattern, NotificationKeyframes, ToastPattern, waitingAgents } from "./waiting-notification-patterns";

function ToastStory() {
  const [key, setKey] = useState(0);
  const [agents, setAgents] = useState(waitingAgents);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  return (
    <div className="flex min-h-[var(--app-viewport-height)] flex-col items-center justify-center gap-4 p-5">
      <PhoneFrame>
        <MockShellScreen overlay={<ToastPattern key={key} agents={agents} onOpen={(agent) => { setAgents([]); setLastOpened(agent.name); }} />} />
      </PhoneFrame>
      <div className="flex items-center gap-3">
        <button className="rounded-full border border-line-strong bg-[rgb(10_22_13_/_92%)] px-4 py-2 font-mono text-[0.62rem] text-[#8cb793] transition-colors hover:text-lime" type="button" onClick={() => { setKey((current) => current + 1); setAgents(waitingAgents); setLastOpened(null); }}>↻ Replay notification</button>
        {lastOpened ? <p className="m-0 font-mono text-[0.58rem] text-amber" role="status">opened → {lastOpened} (notification dismissed)</p> : null}
      </div>
    </div>
  );
}

const meta = {
  title: "Concept/Waiting notifications",
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

export const PatternATopToast: Story = {
  name: "A · Floating toast (left countdown, swipe to dismiss)",
  render: () => <ToastStory />,
};

export const PatternBDock: Story = {
  name: "B · Bottom dock",
  render: () => (
    <PhoneFrame>
      <MockShellScreen overlay={<DockPattern agents={waitingAgents} />} />
    </PhoneFrame>
  ),
};

export const PatternCBanner: Story = {
  name: "C · Terminal banner (top edge)",
  render: () => (
    <PhoneFrame>
      <MockShellScreen overlay={<BannerPattern agents={waitingAgents} />} />
    </PhoneFrame>
  ),
};

export const CompareAll: Story = {
  name: "Compare · all three",
  render: () => (
    <div className="flex min-h-[var(--app-viewport-height)] flex-wrap items-start justify-center gap-6 p-5">
      <figure className="m-0">
        <PhoneFrame>
          <MockShellScreen overlay={<ToastPattern agents={waitingAgents} />} />
        </PhoneFrame>
        <figcaption className="mt-2 text-center font-mono text-[0.62rem] text-[#719176]">A · Floating toast</figcaption>
      </figure>
      <figure className="m-0">
        <PhoneFrame>
          <MockShellScreen overlay={<DockPattern agents={waitingAgents} />} />
        </PhoneFrame>
        <figcaption className="mt-2 text-center font-mono text-[0.62rem] text-[#719176]">B · Bottom dock</figcaption>
      </figure>
      <figure className="m-0">
        <PhoneFrame>
          <MockShellScreen overlay={<BannerPattern agents={waitingAgents} />} />
        </PhoneFrame>
        <figcaption className="mt-2 text-center font-mono text-[0.62rem] text-[#719176]">C · Terminal banner</figcaption>
      </figure>
    </div>
  ),
};
