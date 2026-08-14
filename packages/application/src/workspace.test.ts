import type { WorkspaceRecord } from "@mobile-agent/domain";
import { describe, expect, it } from "vitest";
import { WorkspaceCrud, type RegisterWorkspaceInput, type UpdateWorkspaceInput, type WorkspaceDirectoryPort, type WorkspaceRepository } from "./index.js";

type WorkspaceStep =
  | { type: "register"; input: RegisterWorkspaceInput }
  | { type: "update"; selector: string; input: UpdateWorkspaceInput }
  | { type: "delete"; selector: string };

type WorkspaceScenario = {
  name: string;
  steps: readonly WorkspaceStep[];
  expectedCount: number;
  expectedName: string;
  expectedPatterns: string[];
  expectedAuditEvents: string[];
};

type Outcome =
  | { ok: true; value: WorkspaceRecord }
  | { ok: false; error: unknown };

type ScenarioContext = {
  records: WorkspaceRecord[];
  auditEvents: string[];
  outcomes: Outcome[];
};

const scenarios = [
  {
    name: "registers and updates metadata through the shared application service",
    steps: [
      { type: "register", input: { directory: "/work/project", name: "project", worktreeCopyPatterns: [".env"] } },
      { type: "update", selector: "project", input: { name: "renamed", appendCopyPatterns: ["config/**/*.local.json"] } },
    ],
    expectedCount: 1,
    expectedName: "renamed",
    expectedPatterns: [".env", "config/**/*.local.json"],
    expectedAuditEvents: ["workspace.created", "workspace.updated"],
  },
  {
    name: "deletes only the registered record through the shared application service",
    steps: [
      { type: "register", input: { directory: "/work/project" } },
      { type: "delete", selector: "workspace-1" },
    ],
    expectedCount: 0,
    expectedName: "",
    expectedPatterns: [],
    expectedAuditEvents: ["workspace.created", "workspace.deleted"],
  },
] satisfies readonly WorkspaceScenario[];

describe("workspace application use cases", () => {
  it.each(scenarios)("$name", async (scenario) => {
    const context = await executeScenario(scenario);

    expect(context.outcomes).toHaveLength(scenario.steps.length);
    for (const [index, outcome] of context.outcomes.entries()) {
      expect(outcome, `step ${index + 1} should succeed`).toMatchObject({ ok: true });
    }
    expect(context.records).toHaveLength(scenario.expectedCount);
    if (scenario.expectedCount > 0) {
      expect(context.records[0]).toMatchObject({
        name: scenario.expectedName,
        rootPath: "/work/project",
        worktreeCopyPatterns: scenario.expectedPatterns,
      });
    }
    expect(context.auditEvents).toEqual(scenario.expectedAuditEvents);
  });
});

async function executeScenario(scenario: WorkspaceScenario): Promise<ScenarioContext> {
  const repository = new FakeWorkspaceRepository();
  const directory = new FakeWorkspaceDirectory();
  const auditEvents: string[] = [];
  const crud = new WorkspaceCrud(repository, directory, {
    now: () => "2026-08-15T00:00:00.000Z",
    audit: { record: (eventType) => { auditEvents.push(eventType); } },
  });
  const outcomes: Outcome[] = [];

  for (const step of scenario.steps) {
    try {
      const value = step.type === "register"
        ? await crud.register.execute(step.input)
        : step.type === "update"
          ? await crud.update.execute(step.selector, step.input)
          : await crud.delete.execute(step.selector);
      outcomes.push({ ok: true, value });
    } catch (error) {
      outcomes.push({ ok: false, error });
    }
  }

  return { records: await repository.list(), auditEvents, outcomes };
}

class FakeWorkspaceRepository implements WorkspaceRepository {
  private records: WorkspaceRecord[] = [];

  public async findById(id: string): Promise<WorkspaceRecord | undefined> {
    return this.records.find((record) => record.id === id);
  }

  public async list(): Promise<WorkspaceRecord[]> {
    return [...this.records];
  }

  public async insert(record: WorkspaceRecord): Promise<boolean> {
    if (this.records.some((candidate) => candidate.id === record.id)) return false;
    this.records.push(record);
    return true;
  }

  public async upsert(record: WorkspaceRecord): Promise<void> {
    this.records = [...this.records.filter((candidate) => candidate.id !== record.id), record];
  }

  public async delete(id: string): Promise<void> {
    this.records = this.records.filter((record) => record.id !== id);
  }
}

class FakeWorkspaceDirectory implements WorkspaceDirectoryPort {
  public resolveDirectory(directory: string) {
    return {
      id: "workspace-1",
      rootPath: directory === "project" ? "/work/project" : directory,
      name: "project",
      isGit: true,
    };
  }

  public resolveHook(path: string): string {
    return `/work/project/${path}`;
  }
}
