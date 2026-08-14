import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "@mobile-agent/domain";
import { createLogger, type LogRecord } from "@mobile-agent/logging";
import { createAgentDatabase, DrizzleAgentSessionRepository, DrizzleWorkspaceRepository } from "@mobile-agent/persistence";
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

  it("keeps daemon log-level configuration out of attached CLI verbosity", async () => {
    const output = captureOutput();
    const command = new AgentCommand({
      env: { AGENT_LOG_LEVEL: "debug" },
      io: { out: output, err: output },
    });
    await expect(command.execute(["help"])).resolves.toBe(0);
    command.close();

    expect(output.value()).not.toContain("command.started");
  });

  it("emits detailed lifecycle diagnostics at debug level without logging backend arguments", async () => {
    const fixture = createFixture();
    const records: LogRecord[] = [];
    const logger = createLogger({
      service: "agent-cli",
      mode: "attached",
      level: "debug",
      sink: { write: (record) => records.push(record) },
    });
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: fixture.env,
      logger,
      io: { out: captureOutput(), err: captureOutput() },
    });

    try {
      await expect(command.execute(["run", "claude", "--no-worktree", "--", "--prompt", "sensitive prompt"])).resolves.toBe(0);
    } finally {
      command.close();
      logger.close();
    }

    const events = records.map((record) => record.event);
    expect(events).toContain("command.started");
    expect(events).toContain("database.opened");
    expect(events).toContain("session.created");
    expect(events).toContain("subprocess.started");
    expect(events).toContain("subprocess.finished");
    expect(events).toContain("session.finished");
    expect(JSON.stringify(records)).not.toContain("sensitive prompt");
    expect(records.find((record) => record.event === "subprocess.finished")).toMatchObject({
      fields: { kind: "backend", exitCode: 0 },
    });
  });

  it("runs registered workspace hooks, creates a worktree, and cleans it up through SQLite state", async () => {
    const fixture = createFixture();
    const realWorktree = realpathSync(fixture.worktree);
    const database = createAgentDatabase(fixture.database);
    await new DrizzleWorkspaceRepository(database.db).upsert({
      id: createHash("sha256").update(realpathSync(fixture.workspace)).digest("hex").slice(0, 16),
      rootPath: realpathSync(fixture.workspace),
      name: "workspace",
      isGit: true,
      setupScriptPath: fixture.setupHook,
      cleanupScriptPath: fixture.cleanupHook,
      worktreeCopyPatterns: [".env", "config/**/*.local.json"],
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    database.close();
    const output = captureOutput();
    const command = new AgentCommand({ cwd: fixture.workspace, databaseFile: fixture.database, env: fixture.env, io: { out: output, err: output } });
    try {
      await expect(command.execute(["run", "claude", "--worktree", "session"])).resolves.toBe(0);
    } finally {
      command.close();
    }

    expect(readFileSync(fixture.log, "utf8")).toContain(`setup cwd=${realWorktree}/session`);
    expect(readFileSync(fixture.log, "utf8")).toContain("setup env=secret-from-workspace nested=local-config");
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
    writeExecutable(fakeCodex, `#!/bin/sh\nprintf 'codex:' >>"$TEST_AGENT_REMOTE_LOG"\nfor arg in "$@"; do printf ' [%s]' "$arg" >>"$TEST_AGENT_REMOTE_LOG"; done\nprintf '\\n' >>"$TEST_AGENT_REMOTE_LOG"\nif [ "\${1:-}" = "app-server" ]; then exit 0; fi\nmkdir -p "$CODEX_HOME/sessions/test"\nprintf '{"timestamp":"2026-08-14T00:00:00.000Z","type":"session_meta","payload":{"id":"%s","session_id":"%s","cwd":"%s","originator":"codex_chatgpt_ios_remote","thread_source":"user"}}\\n' "$TEST_AGENT_SESSION_ID" "$TEST_AGENT_SESSION_ID" "$PWD" >"$CODEX_HOME/sessions/test/$TEST_AGENT_SESSION_ID.jsonl"\n`);
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
    command.close();

    // Simulate a session created by the pre-0.147.0 parser, which left the
    // backend mapping empty even though Codex persisted its rollout file.
    const database = createAgentDatabase(fixture.database);
    const sessions = new DrizzleAgentSessionRepository(database.db);
    const workspaceId = createHash("sha256").update(realpathSync(fixture.workspace)).digest("hex").slice(0, 16);
    const stored = await sessions.findByName(workspaceId, "remote");
    if (!stored) throw new Error("test session was not persisted");
    await sessions.update({ ...stored, backendSessionId: null });
    database.close();

    const resumeOutput = captureOutput();
    const resumed = new AgentCommand({
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
      io: { out: resumeOutput, err: resumeOutput },
    });
    await expect(resumed.execute(["resume", "remote"])).resolves.toBe(0);

    const repairedDatabase = createAgentDatabase(fixture.database);
    const repaired = await new DrizzleAgentSessionRepository(repairedDatabase.db).findByName(workspaceId, "remote");
    repairedDatabase.close();
    await expect(resumed.execute(["cleanup", "remote"])).resolves.toBe(0);
    resumed.close();

    expect(readFileSync(remoteLog, "utf8")).toContain("[app-server] [daemon] [enable-remote-control]");
    expect(readFileSync(remoteLog, "utf8")).toContain("[resume] [codex-session-id]");
    expect(readFileSync(nameLog, "utf8")).toContain("[--name] [remote]");
    expect(readFileSync(nameLog, "utf8")).toContain("[--archive]");
    expect(resumeOutput.value()).toContain("recovered Codex session ID for 'remote'");
    expect(repaired?.backendSessionId).toBe("codex-session-id");
  });

  it("does not wait for a missing remote rollout before finishing", async () => {
    const fixture = createFixture();
    const fakeCodex = join(fixture.root, "fake-codex-no-rollout");
    writeExecutable(fakeCodex, `#!/bin/sh
if [ "\${1:-}" = "app-server" ]; then exit 0; fi
exit 0
`);
    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: {
        ...fixture.env,
        AGENT_CODEX_BIN: fakeCodex,
        CODEX_HOME: join(fixture.root, "codex-home"),
      },
      io: { out: output, err: output },
    });
    const startedAt = Date.now();
    await expect(command.execute(["run", "codex", "--no-worktree", "-n", "missing"])).resolves.toBe(0);
    const elapsedMs = Date.now() - startedAt;
    command.close();

    expect(elapsedMs).toBeLessThan(2_000);
    expect(output.value()).toContain("rollout scan:");
    expect(output.value()).toContain("files=0");
    expect(output.value()).toContain("root=missing");
  });

  it("reports privacy-safe reasons for rejected Codex rollouts", async () => {
    const fixture = createFixture({ AGENT_CODEX_REMOTE: "" });
    const codexHome = join(fixture.root, "codex-home");
    const sessionRoot = join(codexHome, "sessions", "diagnostic");
    mkdirSync(sessionRoot, { recursive: true });
    const workspaceRoot = realpathSync(fixture.workspace);
    const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const database = createAgentDatabase(fixture.database);
    await new DrizzleAgentSessionRepository(database.db).insert({
      ...sessionFixture("codex"),
      id: "diagnostic-id",
      name: "diagnostic",
      workspaceId,
      workspaceRoot,
      workspaceName: "workspace",
      backendSessionId: null,
      codexRemote: "",
      codexSessionBaseline: JSON.stringify({ codexSessions: ["baseline-session"] }),
      createdAt,
      updatedAt: new Date(Date.now() + 5_000).toISOString(),
    });
    database.close();

    writeFileSync(join(sessionRoot, "invalid.jsonl"), "not-json\n");
    writeFileSync(join(sessionRoot, "event.jsonl"), `${JSON.stringify({ type: "event" })}\n`);
    writeFileSync(join(sessionRoot, "missing-id.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { cwd: workspaceRoot, originator: "codex-tui", thread_source: "user" } })}\n`);
    writeFileSync(join(sessionRoot, "wrong-cwd.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "wrong-cwd", session_id: "wrong-cwd", cwd: "/other", originator: "codex-tui", thread_source: "user" } })}\n`);
    writeFileSync(join(sessionRoot, "originator.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "originator", session_id: "originator", cwd: workspaceRoot, originator: "codex-cli", thread_source: "user" } })}\n`);
    writeFileSync(join(sessionRoot, "subagent.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "subagent", session_id: "subagent", cwd: workspaceRoot, originator: "codex-tui", thread_source: "subagent" } })}\n`);
    writeFileSync(join(sessionRoot, "baseline.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "baseline-session", session_id: "baseline-session", cwd: workspaceRoot, originator: "codex-tui", thread_source: "user" } })}\n`);

    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: { ...fixture.env, CODEX_HOME: codexHome },
      io: { out: output, err: output },
    });
    await expect(command.execute(["resume", "diagnostic"])).rejects.toThrow("no backend session ID");
    command.close();

    expect(output.value()).toContain("rollout scan:");
    expect(output.value()).toContain("invalid_json=1");
    expect(output.value()).toContain("not_session_meta=1");
    expect(output.value()).toContain("missing_session_id=1");
    expect(output.value()).toContain("cwd_mismatch=1");
    expect(output.value()).toContain("unsupported_originator=1");
    expect(output.value()).toContain("subagent=1");
    expect(output.value()).toContain("baseline=1");
    expect(output.value()).not.toContain("baseline-session");
  });

  it("does not archive a Codex thread when cleanup has no safe ID mapping", async () => {
    const fixture = createFixture({ AGENT_CODEX_REMOTE: "" });
    const codexHome = join(fixture.root, "codex-home");
    const sessionRoot = join(codexHome, "sessions", "cleanup");
    mkdirSync(sessionRoot, { recursive: true });
    const workspaceRoot = realpathSync(fixture.workspace);
    const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const database = createAgentDatabase(fixture.database);
    await new DrizzleAgentSessionRepository(database.db).insert({
      ...sessionFixture("codex"),
      id: "cleanup-id",
      name: "cleanup",
      workspaceId,
      workspaceRoot,
      workspaceName: "workspace",
      backendSessionId: null,
      codexRemote: "unix://",
      codexSessionBaseline: JSON.stringify({ codexSessions: [] }),
      createdAt,
      updatedAt: new Date(Date.now() + 5_000).toISOString(),
    });
    database.close();
    writeFileSync(join(sessionRoot, "rollout.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "cleanup-session", session_id: "cleanup-session", cwd: workspaceRoot, originator: "codex-tui", thread_source: "user" } })}\n`);

    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: {
        ...fixture.env,
        CODEX_HOME: codexHome,
      },
      io: { out: output, err: output },
    });
    await expect(command.execute(["cleanup", "cleanup"])).resolves.toBe(1);
    command.close();

    expect(output.value()).toContain("cannot archive Codex remote thread; session ID is missing");
    expect(output.value()).toContain("session 'cleanup' retained because cleanup did not complete");
    const verification = createAgentDatabase(fixture.database);
    const stored = await new DrizzleAgentSessionRepository(verification.db).findByName(workspaceId, "cleanup");
    verification.close();
    expect(stored?.backendSessionId).toBeNull();
  });

  it("captures legacy flat Codex session metadata", async () => {
    const fixture = createFixture({ AGENT_CODEX_REMOTE: "", TEST_AGENT_SESSION_ID: "legacy-codex-session" });
    const fakeCodex = join(fixture.root, "fake-codex");
    writeExecutable(fakeCodex, `#!/bin/sh\nmkdir -p "$CODEX_HOME/sessions/test"\nprintf '{"type":"session_meta","id":"%s","session_id":"%s","cwd":"%s","originator":"codex_chatgpt_ios_remote","thread_source":"user"}\\n' "$TEST_AGENT_SESSION_ID" "$TEST_AGENT_SESSION_ID" "$PWD" >"$CODEX_HOME/sessions/test/$TEST_AGENT_SESSION_ID.jsonl"\n`);
    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: { ...fixture.env, AGENT_CODEX_BIN: fakeCodex, CODEX_HOME: join(fixture.root, "codex-home") },
      io: { out: output, err: output },
    });
    await expect(command.execute(["run", "codex", "--no-worktree", "-n", "legacy"])).resolves.toBe(0);
    command.close();

    const database = createAgentDatabase(fixture.database);
    const session = await new DrizzleAgentSessionRepository(database.db).findByName(
      createHash("sha256").update(realpathSync(fixture.workspace)).digest("hex").slice(0, 16),
      "legacy",
    );
    database.close();
    expect(session?.backendSessionId).toBe("legacy-codex-session");
  });

  it("does not guess when multiple Codex rollouts match a missing mapping", async () => {
    const fixture = createFixture({ AGENT_CODEX_REMOTE: "" });
    const codexHome = join(fixture.root, "codex-home");
    const sessionRoot = join(codexHome, "sessions", "test");
    mkdirSync(sessionRoot, { recursive: true });
    const workspaceRoot = realpathSync(fixture.workspace);
    const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const database = createAgentDatabase(fixture.database);
    const sessions = new DrizzleAgentSessionRepository(database.db);
    for (const name of ["first", "second"]) {
      await sessions.insert({
        ...sessionFixture("codex"),
        id: `${name}-id`,
        name,
        workspaceId,
        workspaceRoot,
        workspaceName: "workspace",
        useWorktree: false,
        worktreeRoot: null,
        worktreePath: null,
        branch: null,
        baseCommit: null,
        setupHook: null,
        cleanupHook: null,
        setupOutputFile: null,
        cleanupOutputFile: null,
        backendSessionId: null,
        codexRemote: "",
        codexSessionBaseline: JSON.stringify({ codexSessions: [] }),
        createdAt,
        updatedAt: new Date(Date.now() + 5_000).toISOString(),
      });
      writeFileSync(
        join(sessionRoot, `${name}.jsonl`),
        `${JSON.stringify({ type: "session_meta", payload: { id: `${name}-id`, session_id: `${name}-id`, cwd: workspaceRoot, originator: "codex_chatgpt_ios_remote", thread_source: "user" } })}\n`,
      );
    }
    database.close();

    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: { ...fixture.env, CODEX_HOME: codexHome },
      io: { out: output, err: output },
    });
    await expect(command.execute(["resume", "first"])).rejects.toThrow("no backend session ID");
    command.close();

    const verification = createAgentDatabase(fixture.database);
    const stored = await new DrizzleAgentSessionRepository(verification.db).findByName(workspaceId, "first");
    verification.close();
    expect(output.value()).toContain("cannot safely recover Codex session ID for 'first'");
    expect(stored?.backendSessionId).toBeNull();
  });

  it("does not bind a rollout while another unbound Codex session uses the same directory", async () => {
    const fixture = createFixture({ AGENT_CODEX_REMOTE: "" });
    const codexHome = join(fixture.root, "codex-home");
    const sessionRoot = join(codexHome, "sessions", "test");
    mkdirSync(sessionRoot, { recursive: true });
    const workspaceRoot = realpathSync(fixture.workspace);
    const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const database = createAgentDatabase(fixture.database);
    const sessions = new DrizzleAgentSessionRepository(database.db);
    await sessions.insert({
      ...sessionFixture("codex"),
      id: "target-id",
      name: "target",
      workspaceId,
      workspaceRoot,
      workspaceName: "workspace",
      backendSessionId: null,
      codexRemote: "",
      codexSessionBaseline: JSON.stringify({ codexSessions: [] }),
      createdAt,
      updatedAt: new Date(Date.now() + 5_000).toISOString(),
    });
    await sessions.insert({
      ...sessionFixture("codex"),
      id: "competing-id",
      name: "competing",
      workspaceId,
      workspaceRoot,
      workspaceName: "workspace",
      backendSessionId: null,
      codexRemote: "",
      codexSessionBaseline: JSON.stringify({ codexSessions: [] }),
      createdAt,
      updatedAt: new Date(Date.now() + 5_000).toISOString(),
    });
    database.close();
    writeFileSync(join(sessionRoot, "rollout.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "competing-session", session_id: "competing-session", cwd: workspaceRoot, originator: "codex-tui", thread_source: "user" } })}\n`);

    const output = captureOutput();
    const command = new AgentCommand({
      cwd: fixture.workspace,
      databaseFile: fixture.database,
      env: { ...fixture.env, CODEX_HOME: codexHome },
      io: { out: output, err: output },
    });
    await expect(command.execute(["resume", "target"])).rejects.toThrow("no backend session ID");
    command.close();

    expect(output.value()).toContain("competing_session=1");
    const verification = createAgentDatabase(fixture.database);
    const stored = await new DrizzleAgentSessionRepository(verification.db).findByName(workspaceId, "target");
    verification.close();
    expect(stored?.backendSessionId).toBeNull();
  });
});

function createFixture(extraEnv: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "mobile-agent-cli-test-"));
  temporaryRoots.push(root);
  const workspace = join(root, "workspace");
  const worktree = join(root, "worktrees");
  const state = join(root, "state");
  const log = join(root, "hooks.log");
  const database = join(root, "agentd.sqlite");
  const fakeClaude = join(root, "fake-claude");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  const hooks = join(root, "hooks");
  mkdirSync(hooks, { recursive: true });
  writeExecutable(fakeClaude, `#!/bin/sh\nprintf 'backend cwd=%s\\n' "$PWD" >>"$TEST_AGENT_LOG"\nexit "\${TEST_AGENT_EXIT_STATUS:-0}"\n`);
  const setupHook = join(hooks, "setup");
  const cleanupHook = join(hooks, "cleanup");
  writeExecutable(setupHook, `#!/bin/sh\nprintf 'setup cwd=%s worktree=%s workspace=%s\\n' "$PWD" "$AGENT_WORKTREE" "$AGENT_WORKSPACE" >>"$TEST_AGENT_LOG"\nprintf 'setup env=%s nested=%s\\n' "$(cat .env 2>/dev/null || printf missing)" "$(cat config/local.local.json 2>/dev/null || printf missing)" >>"$TEST_AGENT_LOG"\nprintf 'resource-id=test-resource\\n'\n`);
  writeExecutable(cleanupHook, `#!/bin/sh\nprintf 'cleanup cwd=%s setup-output=%s\\n' "$PWD" "$AGENT_SETUP_OUTPUT_FILE" >>"$TEST_AGENT_LOG"\n`);
  writeFileSync(join(workspace, "README"), "fixture\n");
  writeFileSync(join(workspace, ".gitignore"), ".env\nconfig/*.local.json\n");
  writeFileSync(join(workspace, ".env"), "secret-from-workspace\n");
  mkdirSync(join(workspace, "config"), { recursive: true });
  writeFileSync(join(workspace, "config", "local.local.json"), "local-config\n");
  execFileSync("git", ["init", "-q", workspace]);
  execFileSync("git", ["-C", workspace, "config", "user.email", "agent@example.invalid"]);
  execFileSync("git", ["-C", workspace, "config", "user.name", "Agent Test"]);
  execFileSync("git", ["-C", workspace, "add", "README", ".gitignore"]);
  execFileSync("git", ["-C", workspace, "commit", "-q", "-m", "fixture"]);
  return {
    root,
    workspace,
    setupHook,
    cleanupHook,
    worktree,
    state,
    log,
    database,
    env: {
      ...process.env,
      AGENTD_DB_FILE: database,
      AGENT_HOOK_OUTPUT_DIR: state,
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
