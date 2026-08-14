import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentDatabase, DrizzleWorkspaceRepository } from "@mobile-agent/persistence";
import { AgentCommand } from "./agent-command.js";

type WorkspaceStep = {
  args: string[];
  outcome: "success" | "error";
  errorIncludes?: string;
};

type WorkspaceScenario = {
  name: string;
  fixture?: "plain" | "git-subdirectory";
  steps: WorkspaceStep[];
  expectedWorkspaceCount: number;
  expectedName?: string;
  expectedRootPath?: string;
  expectedSetupHook?: string | null;
  expectedCopyPatterns?: string[];
  outputIncludes: string[];
  directoryMustRemain: boolean;
};

type Outcome =
  | { ok: true; value: number }
  | { ok: false; error: unknown };

type ScenarioContext = {
  fixture: ReturnType<typeof createFixture>;
  output: Writable & { value: () => string };
  outcomes: Outcome[];
  workspaces: Awaited<ReturnType<DrizzleWorkspaceRepository["list"]>>;
};

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const scenarios = [
  {
    name: "adds updates lists and deletes only the workspace registration",
    steps: [
      { args: ["workspace", "add", ".", "--name", "primary", "--copy-pattern", ".env"], outcome: "success" },
      { args: ["list", "--json"], outcome: "success" },
      { args: ["workspace", "update", "primary", "--name", "renamed", "--clear-copy-patterns"], outcome: "success" },
      { args: ["workspace", "list", "--json"], outcome: "success" },
      { args: ["workspace", "delete", "renamed"], outcome: "success" },
      { args: ["list", "--json"], outcome: "success" },
    ],
    expectedWorkspaceCount: 0,
    outputIncludes: [
      "workspace 'primary' added",
      "workspace 'renamed' updated",
      "workspace 'renamed' unregistered; directory was not deleted",
    ],
    directoryMustRemain: true,
  },
  {
    name: "validates hooks and preserves configured workspace metadata",
    steps: [
      { args: ["workspace", "add", ".", "--setup-hook", "hooks/setup", "--copy-pattern", ".env", "--copy-pattern", "config/**/*.local.json"], outcome: "success" },
      { args: ["workspace", "update", "workspace", "--no-setup-hook", "--add-copy-pattern", "tmp/local.json"], outcome: "success" },
      { args: ["workspace", "list", "--json"], outcome: "success" },
    ],
    expectedWorkspaceCount: 1,
    expectedName: "workspace",
    expectedSetupHook: null,
    expectedCopyPatterns: [".env", "config/**/*.local.json", "tmp/local.json"],
    outputIncludes: [],
    directoryMustRemain: true,
  },
  {
    name: "rejects an invalid hook without creating a partial registration",
    steps: [
      { args: ["workspace", "add", ".", "--setup-hook", "hooks/missing"], outcome: "error", errorIncludes: "workspace hook does not exist" },
      { args: ["workspace", "list", "--json"], outcome: "success" },
    ],
    expectedWorkspaceCount: 0,
    outputIncludes: [],
    directoryMustRemain: true,
  },
  {
    name: "exposes session list under the new namespace and the legacy alias",
    steps: [
      { args: ["session", "list", "--global", "--json"], outcome: "success" },
      { args: ["list", "--global", "--json"], outcome: "success" },
    ],
    expectedWorkspaceCount: 0,
    outputIncludes: [],
    directoryMustRemain: true,
  },
  {
    name: "canonicalizes a git subdirectory to the repository root",
    fixture: "git-subdirectory",
    steps: [
      { args: ["workspace", "add", ".", "--name", "git-root"], outcome: "success" },
      { args: ["list", "--global", "--json"], outcome: "success" },
    ],
    expectedWorkspaceCount: 1,
    expectedName: "git-root",
    expectedRootPath: "fixture.workspace",
    outputIncludes: ["workspace 'git-root' added"],
    directoryMustRemain: true,
  },
] satisfies readonly WorkspaceScenario[];

describe("workspace and session CLI commands", () => {
  it.each(scenarios)("$name", async (scenario) => {
    const context = await executeScenario(scenario);

    expect(context.outcomes).toHaveLength(scenario.steps.length);
    for (const [index, step] of scenario.steps.entries()) {
      const outcome = context.outcomes[index]!;
      if (step.outcome === "success") {
        expect(outcome, `step ${index + 1} should succeed`).toMatchObject({ ok: true });
      } else {
        expect(outcome, `step ${index + 1} should fail`).toMatchObject({ ok: false });
        expect(errorText(outcome)).toContain(step.errorIncludes);
      }
    }

    expect(context.workspaces).toHaveLength(scenario.expectedWorkspaceCount);
    if (scenario.expectedName) expect(context.workspaces[0]?.name).toBe(scenario.expectedName);
    if (scenario.expectedRootPath === "fixture.workspace") expect(context.workspaces[0]?.rootPath).toBe(realpathSync(context.fixture.workspace));
    if ("expectedSetupHook" in scenario) expect(context.workspaces[0]?.setupScriptPath).toBe(scenario.expectedSetupHook);
    if (scenario.expectedCopyPatterns) expect(context.workspaces[0]?.worktreeCopyPatterns).toEqual(scenario.expectedCopyPatterns);
    for (const text of scenario.outputIncludes) expect(context.output.value()).toContain(text);
    if (scenario.directoryMustRemain) {
      expect(readdirSync(context.fixture.workspace)).toEqual(expect.arrayContaining(["hooks"]));
      expect(readFileSync(join(context.fixture.workspace, "README"), "utf8")).toBe("workspace fixture\n");
    }
  });
});

async function executeScenario(scenario: WorkspaceScenario): Promise<ScenarioContext> {
  const fixture = createFixture(scenario.fixture ?? "plain");
  const output = captureOutput();
  const command = new AgentCommand({
    cwd: fixture.cwd,
    databaseFile: fixture.database,
    env: fixture.env,
    io: { out: output, err: output },
  });
  const outcomes: Outcome[] = [];
  try {
    for (const step of scenario.steps) {
      try {
        outcomes.push({ ok: true, value: await command.execute(step.args) });
      } catch (error) {
        outcomes.push({ ok: false, error });
      }
    }
  } finally {
    command.close();
  }

  const database = createAgentDatabase(fixture.database);
  const workspaces = await new DrizzleWorkspaceRepository(database.db).list();
  database.close();
  return { fixture, output, outcomes, workspaces };
}

function createFixture(kind: "plain" | "git-subdirectory") {
  const root = mkdtempSync(join(tmpdir(), "mobile-agent-workspace-cli-test-"));
  temporaryRoots.push(root);
  const workspace = join(root, "workspace");
  const hooks = join(workspace, "hooks");
  const database = join(root, "agentd.sqlite");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(workspace, "README"), "workspace fixture\n");
  writeExecutable(join(hooks, "setup"), "#!/bin/sh\nexit 0\n");
  if (kind === "git-subdirectory") {
    execFileSync("git", ["init", "-q", workspace]);
    mkdirSync(join(workspace, "nested"), { recursive: true });
  }
  return {
    root,
    workspace,
    cwd: kind === "git-subdirectory" ? join(workspace, "nested") : workspace,
    database,
    env: {
      ...process.env,
      AGENTD_DB_FILE: database,
      AGENT_ASSUME_YES: "1",
    },
  };
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function captureOutput(): Writable & { value: () => string } {
  let value = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      value += chunk.toString();
      callback();
    },
  }) as Writable & { value: () => string };
  output.value = () => value;
  return output;
}

function errorText(outcome: Outcome): string {
  return outcome.ok ? "" : outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
}
