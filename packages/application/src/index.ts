import type {
  AgentSessionRecord,
  PaneId,
  PaneRecord,
  PaneState,
  WorkspaceRecord,
} from "@mobile-agent/domain";

export { ApplicationError, type AgentdApplication, type AgentdHookEvent } from "./agentd.js";
export { agentdSocketReadyState, type AgentdSocket, type AgentdSocketData } from "./socket.js";

export {
  PairDevice,
  type ApprovedDevice,
  type PairDeviceInput,
  type PairDeviceResult,
  type PairingClaim,
  type PairingControlPort,
  type PairingDeviceType,
  type PairingOffer,
  type PairingPresenterPort,
} from "./pair-device.js";

export {
  DeleteWorkspace,
  InvalidWorkspaceCopyPatternError,
  InvalidWorkspaceNameError,
  ListWorkspaces,
  RegisterWorkspace,
  UpdateWorkspace,
  WorkspaceAlreadyRegisteredError,
  WorkspaceCrud,
  WorkspaceNotFoundError,
  WorkspaceRecordFactory,
  WorkspaceUpdateEmptyError,
  WorkspaceUseCaseError,
  type RegisterWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceAuditPort,
  type WorkspaceDirectoryInfo,
  type WorkspaceDirectoryPort,
} from "./workspace.js";

export type PaneFilter = {
  state?: PaneState;
  kind?: PaneRecord["kind"];
  sessionName?: string;
};

export interface PaneRepository {
  list(filter?: PaneFilter): Promise<PaneRecord[]>;
  findById(id: PaneId): Promise<PaneRecord | undefined>;
  findByTmuxPaneId(tmuxPaneId: string): Promise<PaneRecord | undefined>;
  findByTmuxPaneIdentity(tmuxServerId: string, tmuxPaneId: string): Promise<PaneRecord | undefined>;
  upsert(record: PaneRecord): Promise<void>;
  pruneStalePanes(activePaneIds: readonly PaneId[], olderThan: string, tmuxServerScope: string): Promise<number>;
}

export interface WorkspaceRepository {
  findById(id: string): Promise<WorkspaceRecord | undefined>;
  list(): Promise<WorkspaceRecord[]>;
  insert(record: WorkspaceRecord): Promise<boolean>;
  upsert(record: WorkspaceRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AgentSessionRepository {
  findById(id: string): Promise<AgentSessionRecord | undefined>;
  findByName(workspaceId: string, name: string): Promise<AgentSessionRecord | undefined>;
  list(workspaceId?: string): Promise<AgentSessionRecord[]>;
  insert(record: AgentSessionRecord): Promise<void>;
  update(record: AgentSessionRecord): Promise<void>;
  claimExecution(id: string, expectedExecutionPid: number | null, executionId: string, executionPid: number, executionStartedAt: string): Promise<boolean>;
  setBackendSessionIdIfMissing(id: string, backendSessionId: string): Promise<boolean>;
  delete(id: string): Promise<void>;
}

export interface PaneGateway {
  sendInput(paneId: PaneId, input: string): Promise<void>;
  resize(paneId: PaneId, cols: number, rows: number): Promise<void>;
  close(paneId: PaneId): Promise<void>;
}

export class ListPanes {
  public constructor(private readonly panes: PaneRepository) {}

  public execute(filter?: PaneFilter): Promise<PaneRecord[]> {
    return this.panes.list(filter);
  }
}

export class SendPaneInput {
  public constructor(private readonly panes: PaneRepository, private readonly gateway: PaneGateway) {}

  public async execute(paneId: PaneId, input: string): Promise<void> {
    const pane = await this.panes.findById(paneId);
    if (!pane) throw new Error(`Pane not found: ${paneId}`);
    await this.gateway.sendInput(paneId, input);
  }
}

export class ResizePane {
  public constructor(private readonly panes: PaneRepository, private readonly gateway: PaneGateway) {}

  public async execute(paneId: PaneId, cols: number, rows: number): Promise<void> {
    if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
      throw new Error("Terminal dimensions must be positive integers");
    }
    const pane = await this.panes.findById(paneId);
    if (!pane) throw new Error(`Pane not found: ${paneId}`);
    await this.gateway.resize(paneId, cols, rows);
  }
}
