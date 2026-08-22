import type {
  AgentSessionId,
  AgentSessionRecord,
  PaneId,
  PaneRecord,
  PaneState,
  WorkspaceId,
  WorkspaceRecord,
} from "@muximo/domain";

export { ApplicationError, type MuximodApplication, type MuximodHookEvent } from "./muximod.js";
export {
  createMuximodApplication,
  type MuximodApplicationResources,
  type MuximodApplicationRuntime,
} from "./muximod-service.js";
export {
  agentStatusKey,
  inferUnmanagedAgentState,
  normalizeAgentStatusObservation,
  readManagedAgentObservation,
  recentAgentOutputLimits,
  type AgentStatusObservation,
  type AgentStatusStore,
} from "./agent-status.js";
export {
  AuthStoreError,
  type AuthChallengeResponse,
  type AuthCryptoPort,
  type AuthDeviceRecord,
  type AuthDeviceStatus,
  type AuthDeviceType,
  type AuthPairingClaimRequest,
  type AuthPairingClaimResponse,
  type AuthPairingClaimNotification,
  type AuthPairingPayload,
  type AuthPairingRecord,
  type AuthPairingStatus,
  type AuthSessionRecord,
  type AuthSessionResponse,
  type AuthStorePort,
  type ClaimPairingInput,
  type ClaimPairingResult,
  type CreatePairingInput,
  type CreatePairingResult,
  type MuximodAuthContext,
  type MuximodAuthControlPort,
  type MuximodAuthDevice,
  type MuximodAuthPort,
  type PublicKeyJwk,
  type WsTicketResponse,
} from "./auth.js";
export { AuthService } from "./auth-service.js";
export type { AuthServiceOptions } from "./auth-service.js";
export { muximodSocketReadyState, type MuximodSocket, type MuximodSocketData } from "./socket.js";
export {
  type AgentExecutionObservation,
  type MuximodHostPort,
  type MuximodLiveSnapshot,
  type MuximodPaneRef,
  type MuximodPaneSnapshot,
  type MuximodViewportPort,
  type MuximodWorkspaceCatalogPort,
} from "./muximod-host.js";
export {
  type CreatePaneInput,
  type CreateSessionInput,
  type MuximodPanePlacement,
  type MuximodPaneSummary,
  type MuximodSessionSummary,
  type MuximodTerminalEndpoint,
  type MuximodWorkspaceDirectory,
  type RegisterWorkspaceCommand,
  type UpdateWorkspaceCommand,
} from "./muximod-models.js";

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
export type { TransactionManager } from "./transactions.js";

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
  findById(id: WorkspaceId): Promise<WorkspaceRecord | undefined>;
  list(): Promise<WorkspaceRecord[]>;
  insert(record: WorkspaceRecord): Promise<boolean>;
  upsert(record: WorkspaceRecord): Promise<void>;
  delete(id: WorkspaceId): Promise<void>;
}

export interface AgentSessionRepository {
  findById(id: AgentSessionId): Promise<AgentSessionRecord | undefined>;
  findByName(workspaceId: WorkspaceId, name: string): Promise<AgentSessionRecord | undefined>;
  list(workspaceId?: WorkspaceId): Promise<AgentSessionRecord[]>;
  insert(record: AgentSessionRecord): Promise<void>;
  update(record: AgentSessionRecord): Promise<void>;
  claimExecution(id: AgentSessionId, expectedExecutionPid: number | null, executionId: string, executionPid: number, executionStartedAt: string): Promise<boolean>;
  setBackendSessionIdIfMissing(id: AgentSessionId, backendSessionId: string): Promise<boolean>;
  delete(id: AgentSessionId): Promise<void>;
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
