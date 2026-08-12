import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, relative, resolve } from "node:path";
import type { WorkspaceDirectoryOption, WorkspaceRecord, WorkspaceSelection } from "@mobile-agent/domain";
import { validateWorkspaceSelection } from "@mobile-agent/domain";
import type { RegisterWorkspaceRequest, WorkspaceDirectory } from "@mobile-agent/protocol";

export type InvalidDirectoryReason = "not_found" | "not_directory" | "outside_allowed_root" | "unknown_workspace";
export type InvalidHookReason = "not_found" | "not_file" | "not_executable";

export class InvalidWorkspaceDirectoryError extends Error {
  public readonly code = "invalid_directory" as const;

  public constructor(
    public readonly directory: string,
    public readonly reason: InvalidDirectoryReason,
    public readonly allowedRoots: string[],
  ) {
    super(invalidDirectoryMessage(directory, reason));
    this.name = "InvalidWorkspaceDirectoryError";
  }

  public get details(): Record<string, unknown> {
    return { directory: this.directory, reason: this.reason, allowedRoots: this.allowedRoots };
  }
}

export class InvalidWorkspaceHookError extends Error {
  public readonly code = "invalid_hook" as const;

  public constructor(public readonly path: string, public readonly reason: InvalidHookReason) {
    super(invalidHookMessage(path, reason));
    this.name = "InvalidWorkspaceHookError";
  }

  public get details(): Record<string, unknown> {
    return { path: this.path, reason: this.reason };
  }
}

/** The host-side directory boundary used by workspace registration and lookup. */
export class AllowedRootPolicy {
  public readonly roots: string[];

  public constructor(roots: readonly string[]) {
    this.roots = unique(roots.map(expandPath).map((root) => realpathIfPresent(root)));
  }

  public contains(directory: string): boolean {
    const candidate = realpathIfPresent(expandPath(directory));
    return this.roots.some((root) => isPathWithin(root, candidate));
  }

  public assertDirectory(directory: string): string {
    const expanded = expandPath(directory);
    if (!existsSync(expanded)) throw new InvalidWorkspaceDirectoryError(directory, "not_found", this.roots);
    if (!statSync(expanded).isDirectory()) throw new InvalidWorkspaceDirectoryError(directory, "not_directory", this.roots);

    const realPath = realpathSync(expanded);
    if (!this.roots.some((root) => isPathWithin(root, realPath))) {
      throw new InvalidWorkspaceDirectoryError(directory, "outside_allowed_root", this.roots);
    }
    return realPath;
  }
}

export class WorkspaceSelectionCatalog {
  public readonly policy: AllowedRootPolicy;

  public constructor(allowedRoots: readonly string[]) {
    this.policy = new AllowedRootPolicy(allowedRoots);
  }

  /** Lists directory candidates for the host-side registration browser. */
  public async browseDirectories(parentPath?: string): Promise<WorkspaceDirectory[]> {
    const bases = parentPath
      ? [this.policy.assertDirectory(parentPath)]
      : this.policy.roots.filter(isDirectory);
    const candidates = parentPath
      ? safeReadDirectory(bases[0]!).map((entry) => resolve(bases[0]!, entry)).filter(isDirectory)
      : bases;

    return candidates
      .filter((directory) => this.policy.contains(directory))
      .map((directory) => this.toDirectoryCandidate(realpathIfPresent(directory)))
      .sort((left, right) => left.directory.localeCompare(right.directory));
  }

  public registerWorkspace(input: RegisterWorkspaceRequest, existing?: WorkspaceRecord): WorkspaceRecord {
    const rootPath = this.policy.assertDirectory(input.directory);
    const now = new Date().toISOString();
    return {
      id: workspaceId(rootPath),
      rootPath,
      name: input.name?.trim() || existing?.name || basename(rootPath) || rootPath,
      isGit: isGitWorkspace(rootPath),
      setupScriptPath: validateHookPath(input.setupScriptPath ?? null),
      cleanupScriptPath: validateHookPath(input.cleanupScriptPath ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  public toDirectoryOption(record: WorkspaceRecord): WorkspaceDirectory {
    return {
      id: record.id,
      name: record.name,
      directory: displayPath(record.rootPath),
      isGit: record.isGit,
      setupScriptPath: record.setupScriptPath ? displayPath(record.setupScriptPath) : null,
      cleanupScriptPath: record.cleanupScriptPath ? displayPath(record.cleanupScriptPath) : null,
    };
  }

  public async resolveWorkspaceDirectory(
    workspaceId: string,
    reader: (id: string) => Promise<WorkspaceRecord | undefined>,
  ): Promise<WorkspaceRecord> {
    const workspace = await reader(workspaceId);
    if (!workspace) throw new InvalidWorkspaceDirectoryError(workspaceId, "unknown_workspace", this.policy.roots);
    return this.resolveRegisteredWorkspace(workspace);
  }

  public async resolveLegacyDirectory(directory: string): Promise<string> {
    return this.policy.assertDirectory(directory);
  }

  public async resolveSelection(
    selection: WorkspaceSelection,
    reader: (id: string) => Promise<WorkspaceRecord | undefined>,
  ): Promise<WorkspaceRecord> {
    const workspace = await this.resolveWorkspaceDirectory(selection.workspaceId, reader);
    const option: WorkspaceDirectoryOption = {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      isGit: workspace.isGit,
      setupScriptPath: workspace.setupScriptPath,
      cleanupScriptPath: workspace.cleanupScriptPath,
    };
    validateWorkspaceSelection(selection, option);
    return workspace;
  }

  private resolveRegisteredWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    const rootPath = this.policy.assertDirectory(workspace.rootPath);
    return {
      ...workspace,
      rootPath,
      isGit: isGitWorkspace(rootPath),
      setupScriptPath: validateHookPath(workspace.setupScriptPath),
      cleanupScriptPath: validateHookPath(workspace.cleanupScriptPath),
    };
  }

  private toDirectoryCandidate(directory: string): WorkspaceDirectory {
    return {
      id: workspaceId(directory),
      name: basename(directory) || directory,
      directory: displayPath(directory),
      isGit: isGitWorkspace(directory),
      setupScriptPath: null,
      cleanupScriptPath: null,
    };
  }
}

export function allowedRootsFromEnvironment(env: NodeJS.ProcessEnv = process.env, fallback = process.cwd()): string[] {
  const configured = (env.AGENTD_WORKSPACE_ROOTS ?? env.AGENTD_ALLOWED_ROOTS)?.trim();
  return configured ? configured.split(delimiter).map((root) => root.trim()).filter(Boolean) : [fallback];
}

function validateHookPath(path: string | null): string | null {
  if (!path) return null;
  const expanded = expandPath(path);
  if (!existsSync(expanded)) throw new InvalidWorkspaceHookError(path, "not_found");
  if (!statSync(expanded).isFile()) throw new InvalidWorkspaceHookError(path, "not_file");
  try {
    accessSync(expanded, constants.X_OK);
  } catch {
    throw new InvalidWorkspaceHookError(path, "not_executable");
  }
  return realpathSync(expanded);
}

function workspaceId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

function realpathIfPresent(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}

function safeReadDirectory(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isGitWorkspace(path: string): boolean {
  return spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).status === 0;
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function invalidDirectoryMessage(directory: string, reason: InvalidDirectoryReason): string {
  switch (reason) {
    case "not_found":
      return `Directory does not exist: ${directory}`;
    case "not_directory":
      return `Path is not a directory: ${directory}`;
    case "outside_allowed_root":
      return `Directory is outside the allowed workspace roots: ${directory}`;
    case "unknown_workspace":
      return `Workspace is not registered: ${directory}`;
  }
}

function invalidHookMessage(path: string, reason: InvalidHookReason): string {
  switch (reason) {
    case "not_found":
      return `Workspace hook does not exist: ${path}`;
    case "not_file":
      return `Workspace hook is not a file: ${path}`;
    case "not_executable":
      return `Workspace hook is not executable: ${path}`;
  }
}
