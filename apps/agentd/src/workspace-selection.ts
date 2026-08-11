import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, relative, resolve } from "node:path";
import type {
  ProjectOption as DomainProjectOption,
  WorkspaceDirectoryOption,
  WorkspaceSelection,
} from "@mobile-agent/domain";
import { validateWorkspaceSelection } from "@mobile-agent/domain";
import type { ProjectOption, WorkspaceDirectory } from "@mobile-agent/protocol";

export type InvalidDirectoryReason = "not_found" | "not_directory" | "outside_allowed_root" | "unknown_workspace";

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
    return {
      directory: this.directory,
      reason: this.reason,
      allowedRoots: this.allowedRoots,
    };
  }
}

/**
 * Normalizes and checks every host directory used by the control plane. The
 * policy is deliberately independent from the web client: an ID selected by
 * the client is resolved again on the host before tmux receives a cwd.
 */
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

export type WorkspaceSelectionCatalogOptions = {
  allowedRoots: readonly string[];
  listProjects?: () => Promise<ProjectOption[]>;
};

export class WorkspaceSelectionCatalog {
  private readonly projectReader: () => Promise<ProjectOption[]>;
  public readonly policy: AllowedRootPolicy;

  public constructor(private readonly options: WorkspaceSelectionCatalogOptions) {
    this.policy = new AllowedRootPolicy(this.options.allowedRoots);
    this.projectReader = options.listProjects ?? (async () => []);
  }

  public async listDirectories(): Promise<WorkspaceDirectory[]> {
    const candidates = new Set<string>();
    for (const root of this.policy.roots) {
      if (!isDirectory(root)) continue;
      candidates.add(root);
      for (const entry of safeReadDirectory(root)) {
        const candidate = resolve(root, entry);
        if (isDirectory(candidate) && this.policy.contains(candidate)) candidates.add(realpathIfPresent(candidate));
      }
    }

    return [...candidates]
      .map((directory) => this.toDirectoryOption(directory))
      .sort((left, right) => left.directory.localeCompare(right.directory));
  }

  public async listProjects(): Promise<ProjectOption[]> {
    return (await this.projectReader()).map((project) => ({
      id: project.id,
      name: project.name,
      directory: project.directory,
    })).sort((left, right) => left.name.localeCompare(right.name));
  }

  public async resolveWorkspaceDirectory(workspaceId: string): Promise<{ id: string; rootPath: string }> {
    const workspace = (await this.listDirectories()).find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new InvalidWorkspaceDirectoryError(workspaceId, "unknown_workspace", this.policy.roots);
    return { id: workspace.id, rootPath: this.policy.assertDirectory(workspace.directory) };
  }

  public async resolveLegacyDirectory(directory: string): Promise<string> {
    return this.policy.assertDirectory(directory);
  }

  public async resolveSelection(selection: WorkspaceSelection): Promise<{
    id: string;
    rootPath: string;
    projectId: string | null;
    projectName: string | null;
  }> {
    const workspace = (await this.listDirectories()).find((candidate) => candidate.id === selection.workspaceId);
    if (!workspace) throw new InvalidWorkspaceDirectoryError(selection.workspaceId, "unknown_workspace", this.policy.roots);

    const projects = await this.listProjects();
    const project = selection.projectId ? projects.find((candidate) => candidate.id === selection.projectId) : undefined;
    const domainWorkspace: WorkspaceDirectoryOption = {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.directory,
      isGit: workspace.isGit,
    };
    const domainProject: DomainProjectOption | undefined = project
      ? { id: project.id, name: project.name, directory: project.directory }
      : undefined;
    validateWorkspaceSelection(selection, domainWorkspace, domainProject);

    return {
      id: workspace.id,
      rootPath: this.policy.assertDirectory(workspace.directory),
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
    };
  }

  private toDirectoryOption(directory: string): WorkspaceDirectory {
    const path = this.policy.assertDirectory(directory);
    return {
      id: workspaceId(path),
      name: basename(path) || path,
      directory: displayPath(path),
      isGit: isGitWorkspace(path),
    };
  }
}

export function allowedRootsFromEnvironment(env: NodeJS.ProcessEnv = process.env, fallback = process.cwd()): string[] {
  const configured = (env.AGENTD_WORKSPACE_ROOTS ?? env.AGENTD_ALLOWED_ROOTS)?.trim();
  return configured ? configured.split(delimiter).map((root) => root.trim()).filter(Boolean) : [fallback];
}

/** Reads the same lightweight project definitions used by `agent project list`.
 * Persisted project records are still supplied by the caller and take
 * precedence when both sources contain the same name. */
export function projectOptionsFromDirectory(root = process.env.AGENT_PROJECTS_ROOT ?? join(process.cwd(), "projects")): ProjectOption[] {
  if (!isDirectory(root)) return [];
  return safeReadDirectory(root)
    .map((name) => ({ name, directory: join(root, name) }))
    .filter((project) => isDirectory(project.directory))
    .map((project) => ({
      id: createHash("sha256").update(`project:${project.name}`).digest("hex").slice(0, 24),
      name: project.name,
      directory: realpathIfPresent(project.directory),
    }));
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
      return `Workspace directory is not selectable: ${directory}`;
  }
}
