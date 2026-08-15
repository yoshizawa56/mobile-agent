import type { WorkspaceRecord, WorkspaceSelection } from "@mobile-agent/domain";
import type {
  CreatePaneRequest,
  PaneSummary,
  RegisterWorkspaceRequest,
  TerminalEndpoint,
  TmuxSession,
  WorkspaceDirectory,
} from "@mobile-agent/protocol";

export type AgentdHookEvent =
  | "client-attached"
  | "client-active"
  | "client-resized"
  | "client-focus-in"
  | "client-detached";

/** A transport-neutral failure that may be mapped by an adapter. */
export class ApplicationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

/**
 * Application use-case port consumed by HTTP, CLI, and future native
 * adapters. It contains no Hono, Bun, tmux, SQLite, or filesystem types.
 */
export type AgentdApplication = {
  terminal: {
    get(): Promise<TerminalEndpoint>;
  };
  workspaces: {
    list(): Promise<WorkspaceDirectory[]>;
    browse(parentPath?: string): Promise<WorkspaceDirectory[]>;
    register(input: RegisterWorkspaceRequest): Promise<WorkspaceDirectory>;
    resolveDirectory(workspaceId: string): Promise<WorkspaceRecord>;
    resolveSelection(selection: WorkspaceSelection): Promise<WorkspaceRecord>;
  };
  sessions: {
    list(): Promise<TmuxSession[]>;
    create(input: { name: string; cwd: string; workspaceId?: string }): Promise<TmuxSession>;
  };
  panes: {
    list(sessionName?: string): Promise<PaneSummary[]>;
    create(input: CreatePaneRequest, workspace?: WorkspaceRecord): Promise<PaneSummary>;
  };
  hooks: {
    handleTmux(event: AgentdHookEvent, client: string): void;
  };
};
