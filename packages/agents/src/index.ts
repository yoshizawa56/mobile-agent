export const agentCapabilities = ["input", "approval", "stop", "resume", "structured_events"] as const;
export type AgentCapability = (typeof agentCapabilities)[number];

export type AgentManifest = {
  id: string;
  version: string;
  displayName: string;
  capabilities: AgentCapability[];
};

export type DetectInput = {
  command: string;
  args: string[];
  cwd: string;
  environment: Record<string, string | undefined>;
};

export type DetectionResult = {
  confidence: number;
  agentId: string;
  name?: string;
};

export type LaunchInput = {
  cwd: string;
  args?: string[];
  environment?: Record<string, string>;
};

export type LaunchSpec = {
  command: string;
  args: string[];
  cwd: string;
  environment: Record<string, string>;
};

export type OutputChunk = {
  data: string;
  at: string;
};

export type AgentObservation =
  | { type: "state_changed"; state: "starting" | "running" | "waiting_input" | "waiting_approval" | "failed" | "completed" | "stopped"; reason?: string }
  | { type: "title_changed"; title: string }
  | { type: "progress"; value?: number; message?: string }
  | { type: "action_requested"; action: ActionDescriptor }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string };

export type ActionDescriptor = {
  id: string;
  label: string;
  dangerous?: boolean;
};

export interface AgentObserver {
  onOutput(chunk: OutputChunk): AgentObservation[];
  onExit(result: { code: number | null; signal: string | null }): AgentObservation[];
}

export interface AgentPluginV1 {
  manifest: AgentManifest;
  detect(input: DetectInput): Promise<DetectionResult | null>;
  launch(input: LaunchInput): Promise<LaunchSpec>;
  createObserver(): AgentObserver;
  actions(): ActionDescriptor[];
}

export class AgentPluginRegistry {
  private readonly plugins = new Map<string, AgentPluginV1>();

  public register(plugin: AgentPluginV1): void {
    if (this.plugins.has(plugin.manifest.id)) throw new Error(`Agent plugin already registered: ${plugin.manifest.id}`);
    this.plugins.set(plugin.manifest.id, plugin);
  }

  public get(id: string): AgentPluginV1 | undefined {
    return this.plugins.get(id);
  }

  public list(): AgentManifest[] {
    return [...this.plugins.values()].map((plugin) => plugin.manifest);
  }
}

export const shellPlugin: AgentPluginV1 = {
  manifest: {
    id: "shell",
    version: "1",
    displayName: "Shell",
    capabilities: ["input", "stop"],
  },
  async detect(input) {
    const command = input.command.split("/").at(-1)?.toLowerCase();
    return command === "zsh" || command === "bash" || command === "fish" || command === "sh"
      ? { confidence: 1, agentId: "shell", name: command }
      : null;
  },
  async launch(input) {
    return { command: input.args?.[0] ?? "sh", args: input.args?.slice(1) ?? [], cwd: input.cwd, environment: input.environment ?? {} };
  },
  createObserver() {
    return {
      onOutput: () => [],
      onExit: ({ code }) => [{ type: "state_changed", state: code === 0 ? "completed" : "failed", reason: "shell exited" }],
    };
  },
  actions: () => [],
};
