import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AllowedRootPolicy, InvalidWorkspaceDirectoryError, WorkspaceSelectionCatalog, allowedRootsFromEnvironment } from "./workspace-selection.js";

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
  it("lists selectable directories and resolves a project worktree selection", async () => {
    const root = mkdtempTracked("mobile-agent-catalog-");
    const repository = mkdirAndReturn(join(root, "mobile-agent"));
    execFileSync("git", ["init", "-q", repository]);
    mkdirAndReturn(join(root, "scratch"));
    const catalog = new WorkspaceSelectionCatalog({
      allowedRoots: [root],
      listProjects: async () => [{ id: "project-1", name: "mobile-agent", directory: "/projects/mobile-agent" }],
    });

    const workspaces = await catalog.listDirectories();
    const selected = workspaces.find((workspace) => workspace.name === "mobile-agent");
    expect(selected).toMatchObject({ name: "mobile-agent", isGit: true });
    await expect(catalog.resolveSelection({ workspaceId: selected!.id, mode: "worktree", projectId: "project-1" })).resolves.toMatchObject({
      id: selected!.id,
      rootPath: realpathSync(repository),
      projectId: "project-1",
      projectName: "mobile-agent",
    });
  });

  it.each([
    { name: "reports an unknown workspace id", mode: "workspace" as const, projectId: null, code: "invalid_directory" },
    { name: "reports a missing project", mode: "worktree" as const, projectId: "missing", code: "project_not_found" },
  ])("$name with a structured error", async ({ mode, projectId, code }) => {
    const root = mkdtempTracked("mobile-agent-selection-");
    const workspace = mkdirAndReturn(join(root, "repository"));
    execFileSync("git", ["init", "-q", workspace]);
    const catalog = new WorkspaceSelectionCatalog({
      allowedRoots: [root],
      listProjects: async () => [{ id: "project-1", name: "repository", directory: "/projects/repository" }],
    });
    const selected = (await catalog.listDirectories()).find((candidate) => candidate.name === "repository")!;
    const selection = { workspaceId: code === "invalid_directory" ? "missing" : selected.id, mode, projectId };

    await expect(catalog.resolveSelection(selection)).rejects.toMatchObject({ code });
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
