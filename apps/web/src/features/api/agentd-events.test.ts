import { describe, expect, it } from "vitest";
import { agentdEventSchema } from "@mobile-agent/protocol";
import { invalidationQueryKeys } from "./agentd-events";

describe("agentd event query invalidation", () => {
  it("invalidates the session summary and its pane list", () => {
    const event = agentdEventSchema.parse({
      type: "session_updated",
      sessionName: "work",
      reason: "pane_created",
      revision: 4,
    });

    expect(invalidationQueryKeys("serve:http://agentd.local", event)).toEqual([
      ["sessions", "serve:http://agentd.local"],
      ["panes", "serve:http://agentd.local", "work"],
    ]);
  });
});
