import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import QRCode from "qrcode";

type PairingPayload = {
  v: 1;
  webOrigin: string;
  agentdBaseUrl: string;
  serverId: string;
  pairingId: string;
  pairingSecret: string;
  expiresAt: number;
};

type ControlResponse =
  | { type: "pairing_created"; pairingId: string; qrUrl: string; payload: PairingPayload }
  | { type: "pairing_claimed"; pairingId: string; serverId: string; deviceName: string; deviceType: string; platform: string | null; clientVersion: string | null; keyFingerprint: string; expiresAt: string }
  | { type: "pairing_result"; pairingId: string; status: "approved" | "rejected"; deviceId?: string }
  | { type: "error"; code: string; message: string };

export type PairCommandOptions = {
  env?: NodeJS.ProcessEnv;
  out?: Writable;
  input?: Readable;
};

type ParsedOptions = {
  controlSocket: string;
  webOrigin: string;
  agentdBaseUrl: string;
};

export class PairCommandError extends Error {}

export class PairCommand {
  private readonly env: NodeJS.ProcessEnv;
  private readonly out: Writable;
  private readonly input: Readable;

  public constructor(options: PairCommandOptions = {}) {
    this.env = { ...process.env, ...options.env };
    this.out = options.out ?? process.stdout;
    this.input = options.input ?? process.stdin;
  }

  public async execute(args: string[]): Promise<number> {
    if (args.includes("-h") || args.includes("--help")) {
      this.write("Usage: agent pair [--web-origin URL] [--agentd-base-url URL] [--control-socket PATH]\n");
      return 0;
    }
    const options = parseOptions(args, this.env);
    const socket = await connectControlSocket(options.controlSocket);
    const reader = createInterface({ input: socket, crlfDelay: Infinity });
    const output = createInterface({ input: this.input, output: this.out });

    try {
      writeControl(socket, { type: "create_pairing", webOrigin: options.webOrigin, agentdBaseUrl: options.agentdBaseUrl });
      for await (const line of reader) {
        const response = parseControlResponse(line);
        if (response.type === "pairing_created") {
          await this.showPairing(response, options);
          continue;
        }
        if (response.type === "pairing_claimed") {
          this.write(`\n端末から接続要求が届きました。\n  名前: ${response.deviceName}\n  種別: ${response.deviceType}\n  platform: ${response.platform ?? "(未申告)"}\n  clientVersion: ${response.clientVersion ?? "(未申告)"}\n  公開鍵 fingerprint: ${response.keyFingerprint}\n`);
          const answer = await output.question("この端末を承認しますか？ [y/N] ");
          if (/^(y|yes)$/i.test(answer.trim())) {
            writeControl(socket, { type: "approve_pairing", pairingId: response.pairingId });
          } else {
            writeControl(socket, { type: "reject_pairing", pairingId: response.pairingId });
          }
          continue;
        }
        if (response.type === "pairing_result") {
          if (response.status === "approved") {
            this.write(`承認しました。deviceId: ${response.deviceId ?? "(不明)"}\n`);
            return 0;
          }
          this.write("ペアリングを拒否しました。\n");
          return 1;
        }
        throw new PairCommandError(`${response.code}: ${response.message}`);
      }
      throw new PairCommandError("agentd control socket closed before pairing completed");
    } finally {
      output.close();
      reader.close();
      socket.destroy();
    }
  }

  private async showPairing(response: Extract<ControlResponse, { type: "pairing_created" }>, options: ParsedOptions): Promise<void> {
    const qr = await QRCode.toString(response.qrUrl, { type: "terminal", small: true });
    this.write("agent pair\n");
    this.write(`Web: ${options.webOrigin}\nagentd: ${response.payload.agentdBaseUrl}\n有効期限: ${new Date(response.payload.expiresAt).toLocaleString()}\n\n`);
    this.write(qr);
    if (!qr.endsWith("\n")) this.write("\n");
    this.write("Web画面でこのQRを読み取ってください。接続要求が届くまで待機します。\n");
  }

  private write(value: string): void {
    this.out.write(value);
  }
}

function parseOptions(args: string[], env: NodeJS.ProcessEnv): ParsedOptions {
  let controlSocket = env.AGENTD_CONTROL_SOCKET ?? defaultControlSocket(env);
  let webOrigin = env.AGENTD_WEB_ORIGIN ?? "http://localhost:5173";
  let agentdBaseUrl = env.AGENTD_PAIRING_BASE_URL ?? "http://127.0.0.1:4317";

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--control-socket") controlSocket = requireValue(argument, args[++index]);
    else if (argument.startsWith("--control-socket=")) controlSocket = argument.slice("--control-socket=".length);
    else if (argument === "--web-origin") webOrigin = requireValue(argument, args[++index]);
    else if (argument.startsWith("--web-origin=")) webOrigin = argument.slice("--web-origin=".length);
    else if (argument === "--agentd-base-url") agentdBaseUrl = requireValue(argument, args[++index]);
    else if (argument.startsWith("--agentd-base-url=")) agentdBaseUrl = argument.slice("--agentd-base-url=".length);
    else throw new PairCommandError(`unknown agent pair option: ${argument}`);
  }

  return { controlSocket, webOrigin, agentdBaseUrl };
}

function defaultControlSocket(env: NodeJS.ProcessEnv): string {
  const databaseFile = env.AGENTD_DB_FILE ?? env.AGENT_DATABASE_FILE;
  return `${databaseFile && databaseFile !== ":memory:" ? databaseFile : join(homedir(), ".local", "state", "mobile-agent", "agentd")}.control.sock`;
}

function requireValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new PairCommandError(`${option} requires a value`);
  return value;
}

function connectControlSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", (error) => reject(new PairCommandError(`could not connect to agentd control socket: ${error.message}`)));
  });
}

function writeControl(socket: Socket, value: object): void {
  socket.write(`${JSON.stringify(value)}\n`);
}

function parseControlResponse(line: string): ControlResponse {
  try {
    const response = JSON.parse(line) as ControlResponse;
    if (!response || typeof response !== "object" || typeof response.type !== "string") throw new Error("invalid response");
    return response;
  } catch {
    throw new PairCommandError("agentd control socket returned invalid JSON");
  }
}
