import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import {
  agentdControlRequestSchema,
  agentdControlResponseSchema,
  type AgentdControlResponse,
  type PairingClaimNotification,
} from "@mobile-agent/protocol";
import { AuthService, pairingPayloadUrl } from "./service.js";

export type AgentdControlServerOptions = {
  socketPath: string;
  auth: AuthService;
};

export class AgentdControlServer {
  private readonly clients = new Set<Socket>();
  private readonly pairingOwners = new Map<string, Socket>();
  private server: Server | undefined;
  private started = false;

  public constructor(private readonly options: AgentdControlServerOptions) {
    this.options.auth.setPairingClaimListener((notification) => this.notifyClaim(notification));
  }

  public start(): void {
    ensureSocketPathIsSafe(this.options.socketPath);
    mkdirSync(dirname(this.options.socketPath), { recursive: true, mode: 0o700 });
    this.server = createServer((socket) => this.handleConnection(socket));
    this.server.listen(this.options.socketPath, () => {
      chmodSync(this.options.socketPath, 0o600);
      this.started = true;
    });
  }

  public stop(): void {
    for (const client of this.clients) client.destroy();
    this.clients.clear();
    this.server?.close();
    this.server = undefined;
    if (this.started && existsSync(this.options.socketPath)) unlinkSync(this.options.socketPath);
    this.started = false;
  }

  private handleConnection(socket: Socket): void {
    this.clients.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim()) this.handleRequest(socket, line);
      }
    });
    socket.on("close", () => {
      this.clients.delete(socket);
      for (const [pairingId, owner] of this.pairingOwners) {
        if (owner !== socket) continue;
        this.pairingOwners.delete(pairingId);
        try {
          this.options.auth.rejectPairing(pairingId);
        } catch {
          // The pairing may already have been approved, rejected, or expired.
        }
      }
    });
    socket.on("error", () => socket.destroy());
  }

  private handleRequest(socket: Socket, line: string): void {
    let rawRequest: unknown;
    try {
      rawRequest = JSON.parse(line) as unknown;
    } catch {
      this.send(socket, { type: "error", code: "invalid_request", message: "control request must be valid JSON" });
      return;
    }
    const parsedRequest = agentdControlRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      this.send(socket, { type: "error", code: "invalid_request", message: "control request has an invalid shape" });
      return;
    }
    const request = parsedRequest.data;

    try {
      if (request.type === "create_pairing") {
        const payload = this.options.auth.createPairing({ webOrigin: request.webOrigin, agentdBaseUrl: request.agentdBaseUrl });
        this.pairingOwners.set(payload.pairingId, socket);
        this.send(socket, { type: "pairing_created", pairingId: payload.pairingId, pairingUrl: pairingPayloadUrl(payload), payload });
        return;
      }
      if (request.type === "approve_pairing") {
        const device = this.options.auth.approvePairing(request.pairingId);
        this.send(socket, { type: "pairing_result", pairingId: request.pairingId, status: "approved", deviceId: device.deviceId });
        return;
      }
      if (request.type === "reject_pairing") {
        this.options.auth.rejectPairing(request.pairingId);
        this.send(socket, { type: "pairing_result", pairingId: request.pairingId, status: "rejected" });
        return;
      }
      this.send(socket, { type: "error", code: "unknown_request", message: "unknown control request" });
    } catch (error) {
      this.send(socket, { type: "error", code: errorCode(error), message: error instanceof Error ? error.message : String(error) });
    }
  }

  private notifyClaim(notification: PairingClaimNotification): void {
    const owner = this.pairingOwners.get(notification.pairingId);
    if (owner && !owner.destroyed) this.send(owner, { type: "pairing_claimed", ...notification });
  }

  private send(socket: Socket, response: AgentdControlResponse): void {
    if (!socket.destroyed) socket.write(`${JSON.stringify(agentdControlResponseSchema.parse(response))}\n`);
  }
}

function ensureSocketPathIsSafe(path: string): void {
  if (!path || path === "/" || path.endsWith("/")) throw new Error(`invalid agentd control socket path: ${path}`);
  if (existsSync(path) && !lstatSync(path).isSocket()) throw new Error(`agentd control socket path is not a socket: ${path}`);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "control_error";
}
