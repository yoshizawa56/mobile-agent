import { describe, expect, it } from "vitest";
import { ListPanes, ResizePane, SendPaneInput, type PaneRepository, type PaneGateway } from "./index.js";
import type { PaneRecord } from "@mobile-agent/domain";

const pane: PaneRecord = {
  id: "pane-1",
  tmuxPaneId: "%1",
  sessionName: "agentd",
  windowId: "@0",
  kind: "shell",
  name: "shell",
  cwd: "/tmp",
  workspaceId: null,
  agentId: null,
  runId: null,
  state: "running",
  title: null,
  lastSeenAt: "2026-08-09T00:00:00.000Z",
};

class FakePanes implements PaneRepository {
  public records = [pane];
  public async list() { return this.records; }
  public async findById(id: string) { return this.records.find((record) => record.id === id); }
  public async findByTmuxPaneId(tmuxPaneId: string) { return this.records.find((record) => record.tmuxPaneId === tmuxPaneId); }
  public async findByTmuxPaneIdentity(_tmuxServerId: string, tmuxPaneId: string) { return this.records.find((record) => record.tmuxPaneId === tmuxPaneId); }
  public async upsert(record: PaneRecord) { this.records = [record]; }
  public async pruneStalePanes(_activePaneIds: readonly string[], _olderThan: string, _tmuxServerScope: string) { return 0; }
}

class FakeGateway implements PaneGateway {
  public inputs: string[] = [];
  public sizes: Array<[number, number]> = [];
  public async sendInput(_paneId: string, input: string) { this.inputs.push(input); }
  public async resize(_paneId: string, cols: number, rows: number) { this.sizes.push([cols, rows]); }
  public async close() {}
}

describe("application use cases", () => {
  it("lists panes through the repository port", async () => {
    const repository = new FakePanes();
    await expect(new ListPanes(repository).execute()).resolves.toEqual([pane]);
  });

  it.each([
    { name: "sends input", run: (repository: FakePanes, gateway: FakeGateway) => new SendPaneInput(repository, gateway).execute("pane-1", "yes\n") },
    { name: "resizes a pane", run: (repository: FakePanes, gateway: FakeGateway) => new ResizePane(repository, gateway).execute("pane-1", 80, 24) },
  ])("$name for a known pane", async ({ run }) => {
    const repository = new FakePanes();
    const gateway = new FakeGateway();
    await expect(run(repository, gateway)).resolves.toBeUndefined();
  });

  it("rejects an unknown pane before touching the gateway", async () => {
    const repository = new FakePanes();
    const gateway = new FakeGateway();
    await expect(new SendPaneInput(repository, gateway).execute("missing", "x")).rejects.toThrow("Pane not found");
    await expect(new ResizePane(repository, gateway).execute("missing", 80, 24)).rejects.toThrow("Pane not found");
    expect(gateway.inputs).toEqual([]);
    expect(gateway.sizes).toEqual([]);
  });
});
