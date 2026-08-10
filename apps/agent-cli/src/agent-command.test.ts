import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "@mobile-agent/domain";
import { AgentCommand, buildResumeCommand, buildRunCommand } from "./agent-command.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agent command migration", () => {
  it.each([
    { name: "injects Codex defaults", backend: "codex" as const, expected: ["codex", "--profile", "local-agent", "--remote", "unix://", "--cd", "/workspace"] },
    { name: "injects Claude lifecycle flags", backend: "claude" as const, expected: ["claude", "--name", "review", "--session-id", "claude-session", "--permission-mode", "auto"] },
  ])("$name", ({ backend, expected }) => {
    const session = sessionFixture(backend);
    expect(buildRunCommand(session, [], "unix://", backend)).toEqual(expected);
  });

  it("places Codex resume before backend arguments", () => {
    const session = sessionFixture("codex");
    expect(buildResumeCommand(session, ["--", "inspect"], "unix://", "codex")).toEqual([
      "codex", "--profile", "local-agent", "--remote", "unix://", "--cd", "/workspace", "resume", "codex-session", "--", "inspect",
    ]);
  });

  it("runs project hooks, creates a worktree, and cleans it up through SQLite state", async () => {
    const fixture = createFixture();
    const realWorktree = realpathSync(fixture.worktree);
    const output = captureOutput();
    const command = new AgentCommand({ cwd: fixture.workspace, databaseFile: fixture.database, env: fixture.env, io: { out: output, err: output } });
    try {
      await expect(command.execute(["run", "claude", "--project", "fixture", "--worktree", "session"])).resolves.toBe(0);
    } finally {
      command.close();
    }

    expect(readFileSync(fixture.log, "utf8")).toContain(`setup cwd=${realWorktree}/session`);
    expect(readFileSync(fixture.log, "utf8")).toContain(`backend cwd=${realWorktree}/session`);
    expect(readFileSync(fixture.log, "utf8")).toContain("cleanup cwd=");
    expect(execFileSync("git", ["-C", fixture.workspace, "worktree", "list", "--porcelain"], { encoding: "utf8" })).not.toContain(`${fixture.worktree}/session`);
    expect(readdirSync(fixture.state)).toEqual([]);
    expect(output.value()).toContain("session 'session' cleaned up");
  });

  it("keeps interrupted sessions resumable and deletes them explicitly", async () => {
    const fixture = createFixture({ TEST_AGENT_EXIT_STATUS: "130" });
    const firstOutput = captureOutput();
    const first = new AgentCommand({ cwd: fixture.workspace, databaseFile: fixture.database, env: fixture.env, io: { out: firstOutput, err: firstOutput } });
    await expect(first.execute(["run", "claude", "--no-worktree", "-n", "interrupted"])).resolves.toBe(130);
    first.close();

    const secondOutput = captureOutput();
    const second = new AgentCommand({ cwd: fixture.workspace, databaseFile: fixture.database, env: { ...fixture.env, TEST_AGENT_EXIT_STATUS: "0" }, io: { out: secondOutput, err: secondOutput } });
    await expect(second.execute(["resume", "interrupted"])).resolves.toBe(0);
    await expect(second.execute(["cleanup", "interrupted"])).resolves.toBe(0);
    second.close();

    const output = captureOutput();
    const final = new AgentCommand({ cwd: fixture.workspace, databaseFile: fixture.database, env: { ...fixture.env, AGENT_ASSUME_YES: "1" }, io: { out: output, err: output } });
    await expect(final.execute(["list", "--json"])).resolves.toBe(0);
    final.close();
    expect(output.value()).toBe("");
  });

  it("preserves Codex managed remote naming and archive lifecycle", async () => {
    const fixture = createFixture({ TEST_AGENT_SESSION_ID: "codex-session-id" });
    const fakeCodex = join(fixture.root, "fake-codex");
    const fakeName = join(fixture.root, "fake-codex-name");
    const nameLog = join(fixture.root, "name.log");
    const remoteLog = join(fixture.root, "remote.log");
    writeExecutable(fakeCodex, `#!/bin/sh\nprintf 'codex:' >>"$TEST_AGENT_REMOTE_LOG"\nfor arg in "$@"; do printf ' [%s]' "$arg" >>"$TEST_AGENT_REMOTE_LOG"; done\nprintf '\\n' >>"$TEST_AGENT_REMOTE_LOG"\nif [ "\${1:-}" = "app-server" ]; then exit 0; fi\nmkdir -p "$CODEX_HOME/sessions/test"\nprintf '{"type":"session_meta","id":"%s","session_id":"%s","cwd":"%s","originator":"codex_chatgpt_ios_remote","thread_source":"user"}\\n' "$TEST_AGENT_SESSION_ID" "$TEST_AGENT_SESSION_ID" "$PWD" >"$CODEX_HOME/sessions/test/$TEST_AGENT_SESSION_ID.jsonl"\n`);
    writeExecutable(fakeName, `#!/bin/sh\ncase " $* " in\n  *" --archive "*) label=archive ;;\n  *" --unarchive "*) label=unarchive ;;\n  *) label=name ;;\nesac\nprintf '%s:' "$label" >>"$TEST_AGENT_NAME_LOG"\nfor arg in "$@"; do printf ' [%s]' "$arg" >>"$TEST_AGENT_NAME_LOG"; done\nprintf '\\n' >>"$TEST_AGENT_NAME_LOG"\n`);
    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: {
        ...fixture.env,
        AGENT_CODEX_BIN: fakeCodex,
        AGENT_CODEX_NAME_BIN: fakeName,
        CODEX_HOME: join(fixture.root, "codex-home"),
        TEST_AGENT_NAME_LOG: nameLog,
        TEST_AGENT_REMOTE_LOG: remoteLog,
      },
      io: { out: output, err: output },
    });
    await expect(command.execute(["run", "codex", "--no-worktree", "-n", "remote"])).resolves.toBe(0);
    await expect(command.execute(["cleanup", "remote"])).resolves.toBe(0);
    command.close();

    expect(readFileSync(remoteLog, "utf8")).toContain("[app-server] [daemon] [enable-remote-control]");
    expect(readFileSync(nameLog, "utf8")).toContain("[--name] [remote]");
    expect(readFileSync(nameLog, "utf8")).toContain("[--archive]");
  });
});

function createFixture(extraEnv: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "mobile-agent-cli-test-"));
  temporaryRoots.push(root);
  const workspace = join(root, "workspace");
  const projects = join(root, "projects");
  const worktree = join(root, "worktrees");
  const state = join(root, "state");
  const log = join(root, "hooks.log");
  const database = join(root, "agentd.sqlite");
  const fakeClaude = join(root, "fake-claude");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  mkdirSync(join(projects, "fixture", "agent"), { recursive: true });
  writeExecutable(fakeClaude, `#!/bin/sh\nprintf 'backend cwd=%s\\n' "$PWD" >>"$TEST_AGENT_LOG"\nexit "\${TEST_AGENT_EXIT_STATUS:-0}"\n`);
  writeExecutable(join(projects, "fixture", "agent", "setup"), `#!/bin/sh\nprintf 'setup cwd=%s worktree=%s project=%s\\n' "$PWD" "$AGENT_WORKTREE" "$AGENT_PROJECT_NAME" >>"$TEST_AGENT_LOG"\nprintf 'resource-id=test-resource\\n'\n`);
  writeExecutable(join(projects, "fixture", "agent", "cleanup"), `#!/bin/sh\nprintf 'cleanup cwd=%s setup-output=%s\\n' "$PWD" "$AGENT_SETUP_OUTPUT_FILE" >>"$TEST_AGENT_LOG"\n`);
  writeFileSync(join(workspace, "README"), "fixture\n");
  execFileSync("git", ["init", "-q", workspace]);
  execFileSync("git", ["-C", workspace, "config", "user.email", "agent@example.invalid"]);
  execFileSync("git", ["-C", workspace, "config", "user.name", "Agent Test"]);
  execFileSync("git", ["-C", workspace, "add", "README"]);
  execFileSync("git", ["-C", workspace, "commit", "-q", "-m", "fixture"]);
  return {
    root,
    workspace,
    projects,
    worktree,
    state,
    log,
    database,
    env: {
      ...process.env,
      AGENTD_DB_FILE: database,
      AGENT_HOOK_OUTPUT_DIR: state,
      AGENT_PROJECTS_ROOT: projects,
      AGENT_WORKTREE_ROOT: worktree,
      AGENT_CLAUDE_BIN: fakeClaude,
      AGENT_ASSUME_YES: "1",
      TEST_AGENT_LOG: log,
      ...extraEnv,
    },
  };
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o700 });
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

function sessionFixture(backend: "codex" | "claude"): AgentSessionRecord {
  return {
    id: "session-id",
    name: "review",
    backend,
    status: "running",
    workspaceId: "workspace-id",
    workspaceRoot: "/workspace",
    workspaceName: "workspace",
    worktreeRoot: null,
    worktreePath: null,
    branch: null,
    baseCommit: null,
    useWorktree: false,
    projectId: null,
    projectName: null,
    projectDirectory: null,
    setupHook: null,
    cleanupHook: null,
    setupOutputFile: null,
    cleanupOutputFile: null,
    backendSessionId: backend === "codex" ? "codex-session" : "claude-session",
    codexProfile: backend === "codex" ? "local-agent" : null,
    codexRemote: backend === "codex" ? "unix://" : null,
    setupRan: false,
    resuming: false,
    baselineStatus: null,
    codexSessionBaseline: null,
    lastExitStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
