import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, it } from "bun:test";
import {
  acquireRuntimeLock,
  initializeWorktreeDatabase,
  parseWorktreeList,
  resolveWorktreeRuntime,
} from "./dev-state.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("worktree development runtime", () => {
  it("parses the primary worktree before linked worktrees", () => {
    assert.deepEqual(parseWorktreeList("worktree /repo\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\ndetached\n"), [
      { path: "/repo", branch: "refs/heads/main" },
      { path: "/repo/.worktrees/feature", detached: true },
    ]);
  });

  it("gives a linked worktree its own deterministic ports and database path", () => {
    const root = makeTempDirectory();
    const main = join(root, "main");
    const linked = join(root, "linked");
    mkdirSync(main);
    mkdirSync(linked);
    const worktreeList = `worktree ${main}\nbranch refs/heads/main\n\nworktree ${linked}\nbranch refs/heads/feature\n`;

    const primary = resolveWorktreeRuntime({}, main, { worktreeList });
    const runtime = resolveWorktreeRuntime({}, linked, { worktreeList });

    assert.equal(primary.isPrimary, true);
    assert.equal(runtime.isPrimary, false);
    assert.notEqual(runtime.agentdPort, primary.agentdPort);
    assert.notEqual(runtime.webPort, primary.webPort);
    assert.notEqual(runtime.tmuxSocket, primary.tmuxSocket);
    assert.notEqual(runtime.tmuxTarget, primary.tmuxTarget);
    assert.match(runtime.databaseFile, /linked\/\.mobile-agent\/dev\/agentd\.sqlite$/);
  });

  it("seeds a linked worktree once from the primary database without copying WAL sidecars", () => {
    const root = makeTempDirectory();
    const main = join(root, "main");
    const linked = join(root, "linked");
    const mainRuntimeDirectory = join(main, ".mobile-agent", "dev");
    mkdirSync(mainRuntimeDirectory, { recursive: true });
    mkdirSync(linked);
    const sourceFile = join(mainRuntimeDirectory, "agentd.sqlite");
    const source = new Database(sourceFile);
    source.exec("PRAGMA journal_mode = WAL; CREATE TABLE values_table (value TEXT NOT NULL); INSERT INTO values_table VALUES ('from-main');");
    source.close();

    const runtime = resolveWorktreeRuntime({}, linked, {
      worktreeList: `worktree ${main}\nbranch refs/heads/main\n\nworktree ${linked}\nbranch refs/heads/feature\n`,
    });
    const first = initializeWorktreeDatabase(runtime);
    assert.equal(first.seededFrom, join(runtime.primaryPath, ".mobile-agent", "dev", "agentd.sqlite"));
    assert.equal(existsSync(`${runtime.databaseFile}-wal`), false);
    assert.equal(existsSync(`${runtime.databaseFile}-shm`), false);

    const database = new Database(runtime.databaseFile);
    assert.deepEqual(database.query("SELECT value FROM values_table").all(), [{ value: "from-main" }]);
    database.exec("INSERT INTO values_table VALUES ('only-linked')");
    database.close();

    const second = initializeWorktreeDatabase(runtime);
    assert.equal(second.seededFrom, undefined);
    const unchanged = new Database(runtime.databaseFile);
    assert.deepEqual(unchanged.query("SELECT value FROM values_table ORDER BY rowid").all(), [
      { value: "from-main" },
      { value: "only-linked" },
    ]);
    unchanged.close();
  });

  it("migrates the legacy global database into the primary worktree once", () => {
    const root = makeTempDirectory();
    const main = join(root, "main");
    const home = join(root, "home");
    mkdirSync(main);
    mkdirSync(home);
    const legacyFile = join(home, ".local", "state", "mobile-agent", "agentd.sqlite");
    mkdirSync(join(home, ".local", "state", "mobile-agent"), { recursive: true });
    const legacy = new Database(legacyFile);
    legacy.exec("CREATE TABLE values_table (value TEXT NOT NULL); INSERT INTO values_table VALUES ('legacy');");
    legacy.close();

    const runtime = resolveWorktreeRuntime({ HOME: home }, main, {
      worktreeList: `worktree ${main}\nbranch refs/heads/main\n`,
    });
    const result = initializeWorktreeDatabase(runtime);
    assert.equal(result.seededFrom, legacyFile);
    const database = new Database(runtime.databaseFile);
    assert.deepEqual(database.query("SELECT value FROM values_table").all(), [{ value: "legacy" }]);
    database.close();
  });

  it("creates an empty worktree database when no primary snapshot exists", () => {
    const root = makeTempDirectory();
    const main = join(root, "main");
    const linked = join(root, "linked");
    mkdirSync(main);
    mkdirSync(linked);
    const runtime = resolveWorktreeRuntime({ HOME: join(root, "home") }, linked, {
      worktreeList: `worktree ${main}\nbranch refs/heads/main\n\nworktree ${linked}\nbranch refs/heads/feature\n`,
    });

    const result = initializeWorktreeDatabase(runtime);
    assert.equal(result.seededFrom, undefined);
    const database = new Database(runtime.databaseFile);
    assert.deepEqual(database.prepare("PRAGMA quick_check").get(), { quick_check: "ok" });
    database.close();
  });

  it("allows only one dev runtime per worktree", () => {
    const root = makeTempDirectory();
    const main = join(root, "main");
    mkdirSync(main);
    const runtime = resolveWorktreeRuntime({}, main, {
      worktreeList: `worktree ${main}\nbranch refs/heads/main\n`,
    });
    const lock = acquireRuntimeLock(runtime);
    try {
      assert.throws(() => acquireRuntimeLock(runtime), /another dev process already owns/);
    } finally {
      lock.release();
    }
  });
});

function makeTempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "mobile-agent-dev-state-"));
  temporaryDirectories.push(directory);
  return directory;
}
