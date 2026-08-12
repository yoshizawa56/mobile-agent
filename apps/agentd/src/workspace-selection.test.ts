import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AllowedRootPolicy, InvalidWorkspaceDirectoryError, InvalidWorkspaceHookError, WorkspaceSelectionCatalog, allowedRootsFromEnvironment } from "./workspace-selection.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("allowed workspace root policy", () => {
  it.each([
    { name: "reads the documented workspace roots variable", env: { AGENTD_WORKSPACE_ROOTS: "/work:/projects" }, expected: ["/work", "/projects"] },
    { name: "supports the allowed-roots compatibility variable", env: { AGENTD_ALLOWED_ROOTS: "/scratch" }, expected: ["/scratch"] },
    { name: "falls back to the daemon working directory", env: {}, expected: ["/agentd"] },
  ])("$name", ({ env, expected }) => {
    expect(allowedRootsFromEnvironment(env, "/agentd")).toEqual(expected);
  });

  it.each([
    {
      name: "accepts the configured root",
      prepare: (root: string) => root,
      reason: undefined,
    },
    {
      name: "accepts a directory below the configured root",
      prepare: (root: string) => mkdirAndReturn(join(root, "project")),
      reason: undefined,
    },
    {
      name: "rejects a path outside the configured root",
      prepare: (_root: string) => mkdtempTracked("mobile-agent-outside-"),
      reason: "outside_allowed_root",
    },
    {
      name: "rejects a missing directory",
      prepare: (root: string) => join(root, "missing"),
      reason: "not_found",
    },
    {
      name: "rejects a regular file",
      prepare: (root: string) => {
        const file = join(root, "README");
        writeFileSync(file, "fixture\n");
        return file;
      },
      reason: "not_directory",
    },
  ])("$name", ({ prepare, reason }) => {
    const root = mkdtempTracked("mobile-agent-policy-");
    const candidate = prepare(root);
    const policy = new AllowedRootPolicy([root]);
    if (!reason) {
      expect(policy.assertDirectory(candidate)).toBe(realpathSync(candidate));
      return;
    }

    try {
      policy.assertDirectory(candidate);
      throw new Error("expected an invalid directory error");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkspaceDirectoryError);
      expect(error).toMatchObject({ code: "invalid_directory", reason, directory: candidate });
      expect((error as InvalidWorkspaceDirectoryError).details).toEqual({
        directory: candidate,
        reason,
        allowedRoots: [realpathSync(root)],
      });
    }
  });
});

describe("workspace selection catalog", () => {
  it("browses directories, registers a workspace, and resolves a worktree selection", async () => {
    const root = mkdtempTracked("mobile-agent-catalog-");
    const repository = mkdirAndReturn(join(root, "mobile-agent"));
    execFileSync("git", ["init", "-q", repository]);
    mkdirAndReturn(join(root, "scratch"));
    const setup = join(root, "setup");
    writeExecutable(setup);
    const catalog = new WorkspaceSelectionCatalog([root]);

    const workspaces = await catalog.browseDirectories(root);
    const selected = workspaces.find((workspace) => workspace.name === "mobile-agent");
    expect(selected).toMatchObject({ name: "mobile-agent", isGit: true });
    const registered = catalog.registerWorkspace({ directory: repository, setupScriptPath: setup });
    await expect(catalog.resolveSelection({ workspaceId: registered.id, mode: "worktree" }, async () => registered)).resolves.toMatchObject({
      id: registered.id,
      rootPath: realpathSync(repository),
      setupScriptPath: realpathSync(setup),
    });
  });

  it("rejects an unknown registered workspace id", async () => {
    const root = mkdtempTracked("mobile-agent-selection-");
    const catalog = new WorkspaceSelectionCatalog([root]);

    await expect(catalog.resolveSelection({ workspaceId: "missing", mode: "workspace" }, async () => undefined)).rejects.toMatchObject({ code: "invalid_directory" });
  });

  it("rejects a non-executable hook during registration", () => {
    const root = mkdtempTracked("mobile-agent-hook-");
    const workspace = mkdirAndReturn(join(root, "repository"));
    const hook = join(root, "setup");
    writeFileSync(hook, "#!/bin/sh\n");
    expect(() => new WorkspaceSelectionCatalog([root]).registerWorkspace({ directory: workspace, setupScriptPath: hook })).toThrowError(InvalidWorkspaceHookError);
  });
});

function mkdtempTracked(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function mkdirAndReturn(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function writeExecutable(path: string): void {
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
}
