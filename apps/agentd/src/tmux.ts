import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { PanePlacement } from "@mobile-agent/protocol";

export type TmuxWindowSize = "largest" | "smallest" | "manual" | "latest";

export type TmuxPaneRef = {
  paneId: string;
  windowId: string;
  sessionName: string;
};

export type TmuxPane = TmuxPaneRef & {
  windowName: string;
  windowIndex: number;
  cwd: string;
  command: string;
  title: string;
  active: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
  agentdPaneId?: string;
  agentdName?: string;
  agentdKind?: string;
  agentdAgentId?: string;
  agentdRunId?: string;
};

export type TmuxWindowSnapshot = TmuxPaneRef & {
  layout: string;
  visibleLayout: string;
  zoomed: boolean;
  activePaneId: string;
  width: number;
  height: number;
  windowSize: TmuxWindowSize;
};

export type TmuxClient = {
  name: string;
  pid: number;
  tty: string;
  sessionName: string;
  windowId: string;
  paneId: string;
  width: number;
  height: number;
  flags: string;
  activity: number;
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export class TmuxError extends Error {
  public constructor(
    message: string,
    public readonly args: string[],
    public readonly result: CommandResult,
  ) {
    super(message);
    this.name = "TmuxError";
  }
}

export class TmuxAdapter {
  private readonly commandPrefix: string[];

  public constructor(socketPath = process.env.AGENTD_TMUX_SOCKET, configFile?: string) {
    this.commandPrefix = [
      ...(configFile ? ["-f", configFile] : []),
      ...(socketPath ? ["-S", socketPath] : []),
    ];
  }

  public command(args: string[]): CommandResult {
    const fullArgs = [...this.commandPrefix, ...args];
    const result = spawnSync("tmux", fullArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  public require(args: string[]): string {
    const result = this.command(args);
    if (result.status !== 0) {
      throw new TmuxError(
        result.stderr.trim() || `tmux ${args.join(" ")} failed`,
        args,
        result,
      );
    }
    return result.stdout;
  }

  public ensureSession(target: string, cwd: string): void {
    const existing = this.command(["has-session", "-t", target]);
    if (existing.status === 0) return;

    const created = this.command(["new-session", "-d", "-s", target, "-c", resolveTmuxCwd(cwd)]);
    if (created.status !== 0) {
      throw new TmuxError(
        created.stderr.trim() || `Could not create tmux session: ${target}`,
        ["new-session", "-d", "-s", target, "-c", cwd],
        created,
      );
    }
  }

  public hasSession(target: string): boolean {
    return this.command(["has-session", "-t", target]).status === 0;
  }

  public createSession(target: string, cwd: string): void {
    const created = this.command(["new-session", "-d", "-s", target, "-c", resolveTmuxCwd(cwd)]);
    if (created.status !== 0) {
      throw new TmuxError(
        created.stderr.trim() || `Could not create tmux session: ${target}`,
        ["new-session", "-d", "-s", target, "-c", cwd],
        created,
      );
    }
  }

  public newWindow(sessionName: string, cwd: string, command?: string): string {
    const args = [
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      sessionName,
      "-c",
      resolveTmuxCwd(cwd),
    ];
    if (command) args.push(command);
    return this.require(args).trim();
  }

  public splitWindow(
    cwd: string,
    command: string | undefined,
    placement: Exclude<PanePlacement, "window">,
    targetPaneId: string,
    keepZoomed = false,
  ): string {
    const args = [
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
    ];
    if (keepZoomed) args.push("-Z");
    if (placement === "right") args.push("-h");
    args.push("-t", targetPaneId, "-c", resolveTmuxCwd(cwd));
    if (command) args.push(command);
    return this.require(args).trim();
  }

  public setPaneOption(paneId: string, name: string, value: string): void {
    this.require(["set-option", "-p", "-t", paneId, name, value]);
  }

  public capturePane(paneId: string, lines = 48): string {
    return this.require(["capture-pane", "-p", "-e", "-S", String(-Math.abs(lines)), "-t", paneId]);
  }

  public resolvePane(target: string): TmuxPaneRef {
    const output = this.require([
      "display-message",
      "-p",
      "-t",
      target,
      "#{pane_id}\t#{window_id}\t#{session_name}",
    ]);
    const [paneId, windowId, sessionName] = output.trim().split("\t");
    if (!paneId || !windowId || !sessionName) {
      throw new Error(`Could not resolve tmux pane: ${target}`);
    }
    return { paneId, windowId, sessionName };
  }

  public listPanes(): TmuxPane[] {
    const separator = "\u001f";
    const args = [
      "list-panes",
      "-a",
      "-F",
      [
        "#{pane_id}",
        "#{window_id}",
        "#{session_name}",
        "#{window_name}",
        "#{window_index}",
        "#{pane_current_path}",
        "#{pane_current_command}",
        "#{pane_title}",
        "#{pane_active}",
        "#{pane_left}",
        "#{pane_top}",
        "#{pane_width}",
        "#{pane_height}",
        "#{window_width}",
        "#{window_height}",
        "#{@agentd.pane_id}",
        "#{@agentd.pane_name}",
        "#{@agentd.kind}",
        "#{@agentd.agent_id}",
        "#{@agentd.run_id}",
      ].join(separator),
    ];
    const result = this.command(args);
    if (result.status !== 0) {
      // tmux exits its server after the last session disappears. An empty
      // live snapshot is more useful to callers than treating that normal
      // lifecycle transition as an infrastructure failure.
      if (isTmuxServerGone(result.stderr)) return [];
      throw new TmuxError(
        result.stderr.trim() || `tmux ${args.join(" ")} failed`,
        args,
        result,
      );
    }
    const output = result.stdout;

    return output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const [paneId, windowId, sessionName, windowName, windowIndex, cwd, command, title, active, left, top, width, height, windowWidth, windowHeight, agentdPaneId, agentdName, agentdKind, agentdAgentId, agentdRunId] = line.split(separator);
        if (!paneId || !windowId || !sessionName || windowName === undefined || windowIndex === undefined || cwd === undefined || command === undefined || title === undefined) {
          throw new Error(`Could not parse tmux pane: ${line}`);
        }
        return {
          paneId,
          windowId,
          sessionName,
          windowName,
          windowIndex: parseDimension(windowIndex, "window index"),
          cwd,
          command,
          title,
          active: active === "1",
          left: parseDimension(left, "pane left"),
          top: parseDimension(top, "pane top"),
          width: parseDimension(width, "pane width"),
          height: parseDimension(height, "pane height"),
          windowWidth: parseDimension(windowWidth, "window width"),
          windowHeight: parseDimension(windowHeight, "window height"),
          agentdPaneId: nonEmpty(agentdPaneId),
          agentdName: nonEmpty(agentdName),
          agentdKind: nonEmpty(agentdKind),
          agentdAgentId: nonEmpty(agentdAgentId),
          agentdRunId: nonEmpty(agentdRunId),
        } satisfies TmuxPane;
      });
  }

  public snapshotWindow(pane: TmuxPaneRef): TmuxWindowSnapshot {
    const output = this.require([
      "display-message",
      "-p",
      "-t",
      pane.paneId,
      "#{window_layout}\t#{window_visible_layout}\t#{window_zoomed_flag}\t#{window_width}\t#{window_height}",
    ]);
    const [layout, visibleLayout, zoomed, width, height] = output.trim().split("\t");
    if (!layout || !visibleLayout || !width || !height) {
      throw new Error(`Could not snapshot tmux window: ${pane.windowId}`);
    }

    const activePaneId = this.findActivePane(pane.windowId);
    const windowSize = this.readWindowSize(pane.windowId);

    return {
      ...pane,
      layout,
      visibleLayout,
      zoomed: zoomed === "1",
      activePaneId,
      width: parseDimension(width, "window width"),
      height: parseDimension(height, "window height"),
      windowSize,
    };
  }

  public listClients(): TmuxClient[] {
    const output = this.require([
      "list-clients",
      "-F",
      "#{client_name}\t#{client_pid}\t#{client_tty}\t#{client_session}\t#{window_id}\t#{pane_id}\t#{client_width}\t#{client_height}\t#{client_flags}\t#{client_activity}",
    ]);

    return output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const [name, pid, tty, sessionName, windowId, paneId, width, height, flags, activity] = line.split("\t");
        return {
          name,
          pid: parseDimension(pid, "client pid"),
          tty,
          sessionName,
          windowId,
          paneId,
          width: parseDimension(width, "client width"),
          height: parseDimension(height, "client height"),
          flags,
          activity: parseDimension(activity, "client activity"),
        } satisfies TmuxClient;
      })
      .sort((left, right) => right.activity - left.activity);
  }

  public findClientByPid(pid: number): TmuxClient | undefined {
    return this.listClients().find((client) => client.pid === pid);
  }

  public clientView(clientName: string): TmuxClient {
    const output = this.require([
      "display-message",
      "-p",
      "-t",
      clientName,
      "#{client_name}\t#{client_pid}\t#{client_tty}\t#{client_session}\t#{window_id}\t#{pane_id}\t#{client_width}\t#{client_height}\t#{client_flags}\t#{client_activity}",
    ]);
    const [name, pid, tty, sessionName, windowId, paneId, width, height, flags, activity] = output.trim().split("\t");
    return {
      name,
      pid: parseDimension(pid, "client pid"),
      tty,
      sessionName,
      windowId,
      paneId,
      width: parseDimension(width, "client width"),
      height: parseDimension(height, "client height"),
      flags,
      activity: parseDimension(activity, "client activity"),
    };
  }

  public attachArgs(target: string): string[] {
    return [...this.commandPrefix, "attach-session", "-f", "active-pane", "-t", target];
  }

  public switchClient(clientName: string, targetPane: string, keepZoomed = false): void {
    const args = ["switch-client"];
    if (keepZoomed) args.push("-Z");
    args.push("-c", clientName, "-t", targetPane);
    this.require(args);
  }

  public setClientFlags(clientName: string, flags: string): void {
    this.require(["refresh-client", "-f", flags, "-t", clientName]);
  }

  public refreshClient(clientName: string): void {
    // refresh-client without -S requests a complete client redraw. Do not use
    // -r here: in newer tmux versions it reports terminal colours for control
    // mode clients, and older versions reject it entirely.
    this.require(["refresh-client", "-t", clientName]);
  }

  public selectPane(paneId: string, keepZoomed = false): void {
    const args = ["select-pane"];
    if (keepZoomed) args.push("-Z");
    args.push("-t", paneId);
    this.require(args);
  }

  public zoomPane(paneId: string): void {
    this.require(["resize-pane", "-Z", "-t", paneId]);
  }

  public selectLayout(windowId: string, layout: string): void {
    this.require(["select-layout", "-t", windowId, layout]);
  }

  public readWindowSize(windowId: string): TmuxWindowSize {
    const output = this.require(["display-message", "-p", "-t", windowId, "#{window-size}"]).trim();
    if (output === "largest" || output === "smallest" || output === "manual" || output === "latest") {
      return output;
    }
    throw new Error(`Unsupported tmux window-size value: ${output}`);
  }

  public setWindowSize(windowId: string, value: TmuxWindowSize): void {
    this.require(["set-window-option", "-t", windowId, "window-size", value]);
  }

  public resizeWindow(windowId: string, width: number, height: number): void {
    this.require(["resize-window", "-t", windowId, "-x", String(width), "-y", String(height)]);
  }

  public resizeWindowToLargest(windowId: string): void {
    this.require(["resize-window", "-A", "-t", windowId]);
  }

  public resizeWindowToSmallest(windowId: string): void {
    this.require(["resize-window", "-a", "-t", windowId]);
  }

  public restoreWindowSize(
    snapshot: Pick<TmuxWindowSnapshot, "windowId" | "windowSize" | "width" | "height">,
    preferredClient?: Pick<TmuxClient, "width" | "height">,
  ): void {
    const width = preferredClient?.width ?? snapshot.width;
    const height = preferredClient?.height ?? snapshot.height;

    switch (snapshot.windowSize) {
      case "largest":
        this.resizeWindowToLargest(snapshot.windowId);
        break;
      case "smallest":
        this.resizeWindowToSmallest(snapshot.windowId);
        break;
      case "manual":
        this.resizeWindow(snapshot.windowId, snapshot.width, snapshot.height);
        break;
      case "latest":
        this.resizeWindow(snapshot.windowId, width, height);
        if (preferredClient) this.setWindowSize(snapshot.windowId, "latest");
        break;
    }

    if (snapshot.windowSize !== "manual") {
      this.setWindowSize(snapshot.windowId, snapshot.windowSize);
    }
  }

  public restoreSnapshot(snapshot: TmuxWindowSnapshot, preferredClient?: TmuxClient): void {
    this.selectLayout(snapshot.windowId, snapshot.layout);
    this.selectPane(snapshot.activePaneId);
    if (snapshot.zoomed) {
      this.zoomPane(snapshot.activePaneId);
    }
    this.restoreWindowSize(snapshot, preferredClient);
  }

  public setHook(name: string, index: number, command: string): void {
    this.require(["set-hook", "-g", `${name}[${index}]`, command]);
  }

  public unsetHook(name: string, index: number): void {
    this.require(["set-hook", "-gu", `${name}[${index}]`]);
  }

  private findActivePane(windowId: string): string {
    const output = this.require(["list-panes", "-t", windowId, "-F", "#{pane_id}\t#{pane_active}"]);
    const active = output
      .split("\n")
      .map((line) => line.trimEnd().split("\t"))
      .find(([, isActive]) => isActive === "1");
    if (!active?.[0]) throw new Error(`Could not resolve active tmux pane: ${windowId}`);
    return active[0];
  }
}

function parseDimension(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${value ?? ""}`);
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveTmuxCwd(cwd: string): string {
  const expanded = cwd === "~" ? homedir() : cwd.startsWith("~/") ? `${homedir()}/${cwd.slice(2)}` : cwd;
  return resolve(expanded);
}

function isTmuxServerGone(stderr: string): boolean {
  const message = stderr.toLowerCase();
  return message.includes("no server running") || message.includes("no sessions") || message.includes("server exited");
}
