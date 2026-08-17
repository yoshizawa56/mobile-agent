import type { WorkspaceRecord } from "@muximo/domain";
import { isValidWorktreeCopyPattern, normalizeWorktreeCopyPatterns, worktreeCopyPatternLimits } from "@muximo/domain";
import type { WorkspaceRepository } from "./index.js";

export type WorkspaceDirectoryInfo = {
  id: string;
  rootPath: string;
  name: string;
  isGit: boolean;
};

/**
 * Host-specific filesystem and repository checks required by workspace CRUD.
 * The application layer owns the mutation rules; adapters own path resolution
 * and executable-file checks.
 */
export interface WorkspaceDirectoryPort {
  resolveDirectory(directory: string): WorkspaceDirectoryInfo | Promise<WorkspaceDirectoryInfo>;
  resolveHook(path: string, workspaceRoot: string): string | Promise<string>;
}

export interface WorkspaceAuditPort {
  record(eventType: string, entityId: string, payload: unknown): void | Promise<void>;
}

export type RegisterWorkspaceInput = {
  directory: string;
  name?: string;
  setupHook?: string | null;
  cleanupHook?: string | null;
  worktreeCopyPatterns?: readonly string[];
};

export type UpdateWorkspaceInput = {
  name?: string;
  setupHook?: string | null;
  cleanupHook?: string | null;
  worktreeCopyPatterns?: readonly string[];
  appendCopyPatterns?: readonly string[];
  clearCopyPatterns?: boolean;
};

export class WorkspaceUseCaseError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceUseCaseError";
  }
}

export class WorkspaceAlreadyRegisteredError extends WorkspaceUseCaseError {
  public constructor(workspace: WorkspaceDirectoryInfo) {
    super(
      "workspace_already_registered",
      `workspace is already registered: ${workspace.rootPath}`,
      { workspaceId: workspace.id, directory: workspace.rootPath },
    );
    this.name = "WorkspaceAlreadyRegisteredError";
  }
}

export class WorkspaceNotFoundError extends WorkspaceUseCaseError {
  public constructor(selector: string) {
    super("workspace_not_found", `workspace not found: ${selector}`, { selector });
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceUpdateEmptyError extends WorkspaceUseCaseError {
  public constructor() {
    super("workspace_update_empty", "workspace update requires at least one field to change");
    this.name = "WorkspaceUpdateEmptyError";
  }
}

export class InvalidWorkspaceNameError extends WorkspaceUseCaseError {
  public constructor(name: string) {
    super("invalid_workspace_name", invalidWorkspaceNameMessage(name), { name });
    this.name = "InvalidWorkspaceNameError";
  }
}

export class InvalidWorkspaceCopyPatternError extends WorkspaceUseCaseError {
  public constructor(pattern: string) {
    super("invalid_copy_pattern", `invalid worktree copy pattern: ${pattern}`, { pattern });
    this.name = "InvalidWorkspaceCopyPatternError";
  }
}

export class WorkspaceRecordFactory {
  public constructor(
    private readonly directories: WorkspaceDirectoryPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async create(input: RegisterWorkspaceInput, existing?: WorkspaceRecord): Promise<WorkspaceRecord> {
    const directory = await this.directories.resolveDirectory(input.directory);
    const now = this.now();
    const setupScriptPath = input.setupHook === undefined
      ? existing?.setupScriptPath ?? null
      : input.setupHook === null ? null : await this.directories.resolveHook(input.setupHook, directory.rootPath);
    const cleanupScriptPath = input.cleanupHook === undefined
      ? existing?.cleanupScriptPath ?? null
      : input.cleanupHook === null ? null : await this.directories.resolveHook(input.cleanupHook, directory.rootPath);

    return {
      id: directory.id,
      rootPath: directory.rootPath,
      name: input.name === undefined ? existing?.name ?? directory.name : validateWorkspaceName(input.name),
      isGit: directory.isGit,
      setupScriptPath,
      cleanupScriptPath,
      worktreeCopyPatterns: validateWorktreeCopyPatterns(input.worktreeCopyPatterns ?? existing?.worktreeCopyPatterns ?? []),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  public async update(existing: WorkspaceRecord, input: UpdateWorkspaceInput): Promise<WorkspaceRecord> {
    const setupScriptPath = input.setupHook === undefined
      ? existing.setupScriptPath
      : input.setupHook === null ? null : await this.directories.resolveHook(input.setupHook, existing.rootPath);
    const cleanupScriptPath = input.cleanupHook === undefined
      ? existing.cleanupScriptPath
      : input.cleanupHook === null ? null : await this.directories.resolveHook(input.cleanupHook, existing.rootPath);

    let patterns = input.worktreeCopyPatterns === undefined
      ? [...existing.worktreeCopyPatterns]
      : [...input.worktreeCopyPatterns];
    if (input.clearCopyPatterns) {
      if (input.worktreeCopyPatterns !== undefined) {
        throw new WorkspaceUseCaseError("workspace_copy_pattern_conflict", "cannot clear and replace worktree copy patterns in the same update");
      }
      patterns = [];
    }
    patterns = normalizeWorktreeCopyPatterns([...patterns, ...(input.appendCopyPatterns ?? [])]);

    return {
      ...existing,
      name: input.name === undefined ? existing.name : validateWorkspaceName(input.name),
      setupScriptPath,
      cleanupScriptPath,
      worktreeCopyPatterns: validateWorktreeCopyPatterns(patterns),
      updatedAt: this.now(),
    };
  }
}

export class ListWorkspaces {
  public constructor(private readonly workspaces: WorkspaceRepository) {}

  public execute(): Promise<WorkspaceRecord[]> {
    return this.workspaces.list();
  }
}

export class RegisterWorkspace {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly factory: WorkspaceRecordFactory,
    private readonly audit?: WorkspaceAuditPort,
  ) {}

  public async execute(input: RegisterWorkspaceInput): Promise<WorkspaceRecord> {
    const candidate = await this.factory.create(input);
    if (!(await this.workspaces.insert(candidate))) {
      throw new WorkspaceAlreadyRegisteredError({
        id: candidate.id,
        rootPath: candidate.rootPath,
        name: candidate.name,
        isGit: candidate.isGit,
      });
    }
    await this.workspaces.upsert(candidate);
    await this.audit?.record("workspace.created", candidate.id, {
      name: candidate.name,
      directory: candidate.rootPath,
    });
    return candidate;
  }
}

export class UpdateWorkspace {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly directories: WorkspaceDirectoryPort,
    private readonly factory: WorkspaceRecordFactory,
    private readonly audit?: WorkspaceAuditPort,
  ) {}

  public async execute(selector: string, input: UpdateWorkspaceInput): Promise<WorkspaceRecord> {
    if (!hasWorkspaceUpdate(input)) throw new WorkspaceUpdateEmptyError();
    const existing = await findWorkspace(this.workspaces, this.directories, selector);
    const workspace = await this.factory.update(existing, input);
    await this.workspaces.upsert(workspace);
    await this.audit?.record("workspace.updated", workspace.id, {
      name: workspace.name,
      directory: workspace.rootPath,
    });
    return workspace;
  }
}

export class DeleteWorkspace {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly directories: WorkspaceDirectoryPort,
    private readonly audit?: WorkspaceAuditPort,
  ) {}

  public async execute(selector: string): Promise<WorkspaceRecord> {
    const workspace = await findWorkspace(this.workspaces, this.directories, selector);
    await this.workspaces.delete(workspace.id);
    await this.audit?.record("workspace.deleted", workspace.id, {
      name: workspace.name,
      directory: workspace.rootPath,
    });
    return workspace;
  }
}

export class WorkspaceCrud {
  public readonly list: ListWorkspaces;
  public readonly register: RegisterWorkspace;
  public readonly update: UpdateWorkspace;
  public readonly delete: DeleteWorkspace;

  public constructor(
    workspaces: WorkspaceRepository,
    directories: WorkspaceDirectoryPort,
    options: { audit?: WorkspaceAuditPort; now?: () => string } = {},
  ) {
    const factory = new WorkspaceRecordFactory(directories, options.now);
    this.list = new ListWorkspaces(workspaces);
    this.register = new RegisterWorkspace(workspaces, factory, options.audit);
    this.update = new UpdateWorkspace(workspaces, directories, factory, options.audit);
    this.delete = new DeleteWorkspace(workspaces, directories, options.audit);
  }
}

function validateWorkspaceName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120 || /[\u0000\r\n\t]/.test(name)) throw new InvalidWorkspaceNameError(value);
  return name;
}

function validateWorktreeCopyPatterns(values: readonly string[]): string[] {
  const normalized = normalizeWorktreeCopyPatterns(values);
  if (normalized.length > worktreeCopyPatternLimits.maxPatterns) {
    throw new InvalidWorkspaceCopyPatternError(`too many patterns (maximum ${worktreeCopyPatternLimits.maxPatterns})`);
  }
  for (const pattern of normalized) {
    if (!isValidWorktreeCopyPattern(pattern)) throw new InvalidWorkspaceCopyPatternError(pattern);
  }
  return normalized;
}

function hasWorkspaceUpdate(input: UpdateWorkspaceInput): boolean {
  return input.name !== undefined
    || input.setupHook !== undefined
    || input.cleanupHook !== undefined
    || input.worktreeCopyPatterns !== undefined
    || (input.appendCopyPatterns?.length ?? 0) > 0
    || input.clearCopyPatterns === true;
}

async function findWorkspace(
  workspaces: WorkspaceRepository,
  directories: WorkspaceDirectoryPort,
  selector: string,
): Promise<WorkspaceRecord> {
  const reference = selector.trim();
  if (!reference) throw new WorkspaceNotFoundError(selector);
  const records = await workspaces.list();
  const byId = records.find((workspace) => workspace.id === reference);
  if (byId) return byId;

  let resolved: WorkspaceDirectoryInfo | undefined;
  try {
    resolved = await directories.resolveDirectory(reference);
  } catch {
    // A selector is commonly a workspace name. Directory resolution is only
    // a fallback for path selectors, so expected path failures are ignored.
  }
  if (resolved) {
    const byPath = records.find((workspace) => workspace.id === resolved!.id || workspace.rootPath === resolved!.rootPath);
    if (byPath) return byPath;
  }

  const byName = records.filter((workspace) => workspace.name === reference);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new WorkspaceUseCaseError("workspace_name_ambiguous", `workspace name is ambiguous; use its ID: ${reference}`, { selector: reference });
  }
  throw new WorkspaceNotFoundError(reference);
}

function invalidWorkspaceNameMessage(value: string): string {
  const name = value.trim();
  if (!name) return "workspace name cannot be empty";
  if (name.length > 120) return "workspace name cannot exceed 120 characters";
  return "workspace name cannot contain control characters";
}
