# Mobile Agent / agentd Architecture and Specification

Last updated: 2026-08-14

Status: implementation baseline and ongoing design

## 1. Overview

Mobile Agent is a system for managing agent runtimes on tmux panes from a mobile UI. A long-running TypeScript and Bun process named agentd runs on the development host, while an iPhone connects through the web client.

The primary goal is to let a phone operate an existing desktop tmux environment without replacing the desktop workflow:

- list and select agents and shells by pane;
- display one pane in a mobile-sized terminal;
- inspect the agent name, workspace, worktree, and state;
- find panes waiting for input or approval;
- send input, resize, and stop a pane;
- notify the user about waiting-state transitions through notifications and Live Activity;
- add arbitrary agent tools through plugins.

### Decisions

- The host daemon is a TypeScript and Bun process named agentd.
- Bun is the workspace package manager and the runtime for agentd and the unified agent CLI. The Web package uses the pinned Node LTS runtime for Vite, Storybook, Vitest, and TypeScript; this keeps the browser toolchain on its primary ecosystem without changing the shipped browser code.
- The agentd HTTP API is implemented with Hono. createAgentdApp(deps) returns a dependency-injected Hono app. Process startup, SQLite, tmux, PTY, and WebSocket wiring live outside that function.
- ReturnType<typeof createAgentdApp> is exported as AgentdApp and shared with the Hono RPC client in the agentd-client package.
- The mobile API client, connection state, WebSocket handling, and xterm.js integration are implemented in TypeScript. An SSH port-forwarding native bridge may create a route and hand its URLs to the TypeScript client.
- The agent CLI is maintained in this repository. SQLite is the single canonical state source for lifecycle data.
- The legacy dotfiles state-file format is not a compatibility target.
- tmux remains the owner of the real panes. Terminal display uses a PTY connected to tmux attach-session, while administration and monitoring use tmux Control Mode.
- Pane identity uses a Mobile Agent UUID instead of depending on tmux identifiers.
- Plugins normalize agent state. The mobile UI consumes only the common state model.
- HTTP API plus WebSocket is the primary host/mobile protocol. The browser build uses Tailscale Serve as its standard route.
- The browser build stores only a Serve connection profile. It does not access SSH private keys, passwords, or the native Keychain.
- SSH is a future RouteProvider implementation for cases such as a bastion host between the phone and the agentd host.
- The mobile UI is React and TypeScript with xterm.js and can be packaged as an iOS app with Capacitor when needed.
- In the MVP, desktop and mobile share the same tmux pane. While a mobile client is connected, a TmuxViewportLease makes the mobile client the viewport owner.
- The mobile client attaches with active-pane. Pane selection is isolated per client. Because zoom and window size are window-level tmux properties, the desktop view may temporarily become narrow while the phone owns the viewport.
- When a viewport lease is acquired, the existing desktop client receives a temporary active-pane flag so mobile pane selection does not move the desktop cursor. The original client flags are restored when the lease ends.
- tmux client-active, client-resized, and, when available, client-focus-in events return ownership to the desktop and restore its zoom, layout, and size.
- Existing desktop panes are restored from the pre-lease active pane. If no desktop client exists, a client attaching later is treated as a desktop takeover.
- Twin sessions and independent agent Runs are future extensions for plugins that require simultaneous operation or independent sizes.
- Live Activity, Widget, and Keychain integrations are optional native extensions rather than required dependencies of the client.
- The first desktop experience uses an existing terminal, tmux attach, and the TUI. A desktop GUI is added only when demand becomes clear.

## 2. Scope

### In scope

- Development hosts such as macOS and Linux.
- AI agents, regular shells, and arbitrary commands running inside tmux.
- One-pane display, input, and state inspection from an iPhone.
- Secure connections inside a Tailscale network.
- Host-side configuration and execution-history management with SQLite.
- Agent plugins, including Codex and Claude Code integrations.

### Out of scope for the initial release

- A fully embedded Tailscale VPN client on the iPhone.
- Reimplementing a complete desktop terminal emulator as a native desktop GUI.
- Arbitrary terminal input from a Live Activity.
- Determining every agent state solely by parsing rendered screen text.
- Full sandboxing for untrusted third-party plugins.

## 3. Terms and domain model

### Host

The development machine running tmux, agents, and agentd. SQLite also lives on the host.

### Session

A tmux session. It is the unit a person joins with tmux attach; it is not the primary Mobile Agent management unit.

### Pane

A tmux pane. This is the basic unit that Mobile Agent lists and selects.

### Run

A logical unit of work executing inside a pane. A pane can be reused for multiple Runs over time.

### AgentPlugin

A host-side plugin that starts a particular agent tool and converts its output and events into the common state model.

### Profile

Configuration that overrides an existing plugin command, environment, detection rules, notification rules, and other behavior.

### Workspace

A host directory explicitly registered with agentd. It may be a regular checkout or another managed work environment. A registered workspace owns its optional personal setup and cleanup script paths plus relative patterns for copying unmanaged files into generated worktrees; a generated git worktree is an execution directory derived from that workspace.

### Separating Pane and Run

tmux panes are long-lived, while Runs are replaced within a pane. Therefore a pane must not be persisted as a direct one-to-one relationship with an agent.

~~~
Pane
  id: mobile-pane-uuid
  tmuxPaneId: tmux-pane-id
  session: workspace
  window: 0
  currentRunId: run-uuid

Run
  id: run-uuid
  kind: agent | shell
  agentId: codex | claude | custom | null
  name: string
  workspaceId: string | null
  state: starting | running | waiting_input | waiting_approval |
         completed | failed | shell | unknown
~~~

Regular shells use kind=shell and agentId=null in the same model.

tmux pane identifiers can change after a pane is recreated or moved, so mobilePaneId is the primary key. agentd stores user options on the tmux side to support recovery after a restart:

~~~
@agentd.pane_id
@agentd.pane_name
@agentd.kind
@agentd.run_id
@agentd.agent_id
@agentd.workspace_id
@agentd.profile_id
~~~

## 4. System architecture

~~~
                              +---------------------+
                              | iPhone              |
                              | TypeScript client   |
                              | Web + xterm.js      |
                              | Capacitor shell     |
                              +----------+----------+
                                         | HTTPS / WSS
                    Tailscale Serve (standard) / SSH forwarding (future)
                                         |
+----------------------------------------v-------------------------+
| Development host                                             |
|                                                              |
|  +--------------+     +-----------------------------------+  |
|  | agent CLI/TUI|---->| agentd                            |  |
|  +--------------+     | Hono HTTP / WebSocket / PTY       |  |
|                       | Domain / Application / Ports      |  |
|  desktop terminal    | Plugin manager / recovery          |  |
|  -- tmux attach ---->|                                   |  |
|                       +-------------+-------------+---------+  |
|                                     |             |            |
|                         tmux Control Mode / PTY  SQLite/Drizzle|
|                                     |             |            |
|                           tmux sessions/panes  config/history |
+--------------------------------------------------------------+
~~~

agentd is the only process that owns business-logic execution. The CLI, TUI, WebSocket handlers, and future desktop UI all call the same application use cases.

## 5. Repository layout

~~~
apps/
  agent-cli/              # agent command, CLI, and TUI
  agentd/                 # long-running daemon
  web/                    # React + xterm.js UI, also consumed by Capacitor
  desktop-web/            # future desktop web UI

packages/
  agentd-client/          # Hono RPC, HTTP DTO validation, WebSocket client
  cli-adapters/           # CLI infrastructure adapters and composition factories
  domain/                 # entities, value objects, and state machines
  application/            # use cases and ports
  protocol/               # WebSocket DTOs, events, and schemas
  persistence/            # SQLite and Drizzle
  tmux/                   # tmux Control Mode adapter
  agents/                 # AgentPlugin API and built-in plugins
  workspaces/             # workspace and worktree adapters
  notifications/          # NotificationPort implementations
  tailscale/               # Serve, identity, and bootstrap helpers
  config/                 # configuration loading and validation

ios/
  MobileAgentNative/      # SSH port-forwarding bridge, if needed
  MobileAgentWidget/      # future OS extension, separate from the client

docs/
  architecture.md
  research/               # ongoing tmux and individual-pane rendering research
~~~

The domain layer does not reference tmux, SQLite, WebSocket, or Capacitor directly. Implementations connect through ports.

### agentd HTTP app and dependency injection

createAgentdApp does not start a process. It receives only the dependencies needed by the HTTP API and constructs the Hono app.

~~~
createAgentdServer()
  |-- SQLite / Drizzle
  |-- TmuxAdapter
  |-- TmuxViewportManager
  |-- application use cases
  |-- createAgentdApp({ ...deps })
       |-- AgentdApp = ReturnType<typeof createAgentdApp>

agentd-client
  |-- hc<AgentdApp>(connection.httpBaseUrl)
~~~

Tailscale Serve and SSH port forwarding both reach the same agentd API. The API client and use cases do not know which route is in use. The browser build does not include an SSH adapter; it exposes only the Serve route.

~~~
Browser / Serve:  https://host.tailnet/... ----+
Native / Serve:   https://host.tailnet/... ----+-- AgentdClient
Native / SSH:     http://127.0.0.1:xxxxx -----+       |-- HTTP API
                                                        |-- terminal WebSocket
~~~

### Responsibilities of connection routes

~~~ts
type AgentdRoute = {
  kind: "serve" | "same-origin" | "lan" | "ssh"
  httpBaseUrl: string
  websocketUrl: string
  close?: () => Promise<void>
}
~~~

- serve: the standard browser and Capacitor route using HTTPS/WSS and Tailscale ACLs;
- same-origin: a Vite proxy or development route where agentd shares the origin;
- lan: a future explicitly configured LAN route with its own TLS, authentication, CORS, and discovery design;
- ssh: a future native-only route that creates port forwarding through a bastion.

AgentdClient receives an AgentdRoute. It does not know how the route was established and does not reference secrets, the Tailscale CLI, or SSH. A web or native RouteProvider establishes the route. Starting agentd is also outside the route responsibility and is managed by launchd, systemd, or an explicit bootstrap command.

agentd is a long-running control-plane daemon, not a one-shot CLI. It manages tmux, agent plugins, and SQLite on the same host. The name agentd follows the Unix convention of using d for a daemon and clearly separates the daemon from the agent CLI.

## 6. Clean / hexagonal architecture

~~~
Adapters
  CLI / TUI / WebSocket / PTY / SSH / tmux / SQLite / APNs
                         |
                         v
Application use cases
  ListPanes
  OpenPane
  ClosePane
  SendInput
  ResizePane
  SubscribePaneEvents
  CreateWorkspace
  ConfigureAgent
  AcknowledgeWaiting
  PairDevice
                         |
                         v
Domain
  Pane / Run / Workspace / AgentState / Plugin / Event
                         |
                         v
Ports
  TmuxGateway
  TerminalTransport
  AgentRuntime
  PaneRepository
  RunRepository
  WorkspaceRepository
  EventPublisher
  NotificationGateway
  SecretStore
  PairingControlPort
  PairingPresenterPort
~~~

### Application use-case principles

- Use the same use cases from the CLI and the mobile client.
- Do not put business logic in a WebSocket handler.
- Do not let the TUI update SQLite directly.
- Convert tmux management output into common events instead of exposing it directly through the public API. PTY bytes for terminal rendering are a separate data plane.
- Make commands idempotent whenever possible.
- Attach a seq value to external events so a client can resume after reconnecting.

### Web implementation conventions

Use TanStack Router file-based routing. The URL is the source of truth for the current screen and resource selection. Do not keep a product-wide `stage` state as a second navigation system. A route transition must be observable in the browser URL so that refresh, back/forward navigation, deep links, and shared links preserve the user's location.

The current route map is:

~~~text
/terminals
/settings
/terminals/:terminalId/sessions
/terminals/:terminalId/sessions/new
/terminals/:terminalId/sessions/:sessionName
/terminals/:terminalId/sessions/:sessionName/connecting
/terminals/:terminalId/sessions/:sessionName/disconnected
/terminals/:terminalId/sessions/:sessionName/ended
/terminals/:terminalId/sessions/:sessionName/panes/new
/terminals/:terminalId/sessions/:sessionName/panes/:paneId
~~~

The `:paneId` URL segment is the stable `PaneSummary.id` stored by agentd, not tmux's volatile pane target such as `%0`. The route ViewModel resolves that stable ID to the current `tmuxPaneId` only at the terminal transport boundary. This keeps URLs readable and prevents tmux implementation details from leaking into navigation. A legacy tmux target may still be accepted while old links are migrated.

Because these are clean client-side routes, the development and preview servers must return `index.html` for unknown document paths. A production static host needs an equivalent SPA fallback or rewrite rule.

Colocation is the default organization rule: route-specific code belongs in the directory for that route. TanStack Router's `-` prefix keeps colocated support files out of route generation.

~~~text
routes/
  terminals/
    index.tsx
    -terminals-viewmodel.ts
    -terminals-view.tsx
    $terminalId/
      sessions/
        index.tsx
        -sessions-viewmodel.ts
        -sessions-view.tsx
        $sessionName/
          index.tsx
          -session-viewmodel.ts
          -session-view.tsx
          panes/
            $paneId/
              index.tsx
              -control-room-viewmodel.ts
              -control-room-view.tsx
~~~

Each route directory uses the following responsibilities:

- `index.tsx` is the route adapter. It reads route parameters through the router and passes the route ViewModel to the View.
- `-viewmodel.ts` defines the route ViewModel and `useHogeViewModel`. It may compose shared application state and route parameters, but it does not render markup.
- `-view.tsx` is a pure route composition boundary. Reusable visual components may live under `features/`, while path-specific composition stays here.
- `-stories.tsx` contains route-specific Storybook states when the route needs them.

Only genuinely shared code belongs outside the route directory: protocol types, API clients, connection/session state, terminal transport, and reusable feature components. Do not move a component to a shared directory merely because it is convenient; first confirm that two independent routes have the same responsibility.

Each feature should generally have the following three files:

~~~
feature/
  pane-viewmodel.ts  # ViewModel interface and usePaneViewModel
  pane-view.tsx      # pure View receiving the ViewModel as props
  pane-view.stories.tsx
~~~

route.tsx should call useHogeViewModel, process path and search parameters, and pass the result to the View. ViewModels receive unit tests; Views receive comprehensive Storybook state stories.

Use TanStack Query for server state such as pane lists, Run metadata, settings, and mutations. Do not put PTY/WebSocket terminal bytes, connection state, or xterm.js instances in the Query cache. Manage those through the ViewModel and terminal-transport lifecycle.

### Backend testing conventions

Use table-driven tests for domain, application, adapter, and protocol behavior. Normal and error cases should use the same execution shape.

~~~ts
type TestCase<When, Result, Context> = {
  given: () => Promise<unknown> | unknown
  when: (given: unknown) => When
  check: Array<(result: Result) => Promise<unknown> | unknown>
  assert: Array<(context: Context) => void>
}
~~~

A shared runner performs given -> when -> check, storing values in ctx, -> assert. Adapter fixtures use the same format so that the act portion does not need to be duplicated across cases.

## 7. AgentPlugin design

### 7.1 Two levels of extension

#### Declarative profiles

Profiles change an existing agent's behavior without writing code:

- launch command, arguments, and cwd;
- environment variables;
- workspace and worktree selection;
- state-detection rules;
- notification states;
- initial input;
- available actions.

~~~yaml
profiles:
  mobile-codex:
    extends: codex
    command: codex
    args: ["--profile", "mobile"]
    env:
      AGENTD_RUN_ID: "<run-id>"
    notifications:
      states: [waiting_input, waiting_approval, failed]
~~~

#### Code plugins

TypeScript code plugins can implement a custom agent or advanced state analysis:

~~~ts
interface AgentPluginV1 {
  manifest: {
    id: string
    version: string
    displayName: string
    capabilities: AgentCapability[]
    configSchema?: unknown
  }

  detect(input: DetectInput): Promise<DetectionResult | null>
  prepare(input: PrepareInput): Promise<WorkspacePlan>
  launch(input: LaunchInput): Promise<LaunchSpec>
  createObserver(input: ObserverInput): AgentObserver
  actions(ctx: RunContext): ActionDescriptor[]
  execute(action: ActionRequest): Promise<HostCommand[]>
}

interface AgentObserver {
  onOutput(chunk: OutputChunk): AgentObservation[]
  onExit(result: ProcessExit): AgentObservation[]
}
~~~

Plugins return normalized observations:

~~~ts
type AgentObservation =
  | { type: "state_changed"; state: AgentState; reason?: string }
  | { type: "title_changed"; title: string }
  | { type: "progress"; value?: number; message?: string }
  | { type: "action_requested"; action: ActionDescriptor }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
~~~

### 7.2 State-detection priority

1. Structured events, JSONL, an app server, or WebSocket exposed by the agent.
2. Agent process exit, signals, and standard streams.
3. tmux/PTY output state parsers.
4. Regular-expression rules declared by a profile.
5. Manual state changes by the user.

Screen-text parsing is fragile when an agent changes its UI, so built-in plugins should prefer structured events.

### 7.3 Plugin execution

- Built-in and trusted plugins run as TypeScript modules inside agentd.
- Custom or other-language plugins run as child processes using JSONL over stdin/stdout.
- Plugins can be installed from npm packages, repository packages, or the user's XDG configuration directory.
- Plugin code is never distributed to the mobile app.
- Plugins do not access tmux or SQLite directly; they use Context and Port objects provided by agentd.

External plugins isolate crashes from the agentd process. They are not fully sandboxed when they can execute host commands or read files. The installation flow must make this trust boundary explicit.

### 7.4 CLI

~~~sh
agent plugin list
agent plugin add npm:@example/agent-plugin
agent plugin enable example
agent plugin doctor example

agent agent list
agent profile list
agent profile create mobile-codex --extends codex
~~~

## 8. tmux integration

### 8.1 Management and monitoring route

agentd uses tmux Control Mode for management and monitoring:

- receive pane output events such as percent output;
- send input, resize, and selection commands for a pane;
- observe pane creation, exit, and movement;
- use capture-pane for inspection and recovery when necessary.

The initial mobile terminal does not project Control Mode events directly onto the screen. xterm.js owns the responsibility for interpreting terminal screen state.

### 8.2 Mobile terminal data route

For the one-pane mobile view, agentd creates a PTY and attaches a client to the same tmux session with active-pane.

~~~text
xterm.js <-> WebSocket <-> agentd <-> Bun.Terminal <-> tmux attach-session -t <target>
~~~

- agentd forwards terminal bytes from the PTY in binary WebSocket frames without interpreting them;
- xterm.js interprets ANSI/VT sequences, alternate screen, cursor state, scrollback, and selection;
- WebSocket text frames are reserved for control messages such as attach, resize, and detach;
- xterm.js cols/rows are sent back to the PTY so the TUI runs at the phone's actual width;
- while mobile is connected, the target window's window-size is temporarily set to manual and the phone size is applied through resize-window;
- active-pane keeps the mobile active pane separate from the desktop client's active pane;
- zoom and window size are window-level tmux properties, so the desktop may temporarily become narrow while mobile owns the viewport;
- agentd snapshots the layout, zoom, active pane, window-size setting, and actual dimensions when the viewport is acquired;
- desktop activity moves ownership back to the desktop and restores its size;
- when mobile disconnects before a desktop takeover, the snapshot is fully restored; after a takeover, desktop changes win and the old snapshot is not applied over them.

The preferred desktop-activity detection method is for agentd to register a tmux hook that calls an internal localhost HTTP endpoint. If hooks are unavailable, agentd falls back to polling client state. Focus events depend on terminal support, so keyboard input and resize must also trigger restoration.

### 8.3 Desktop integration

Existing terminals continue to work normally:

~~~sh
tmux attach-session -t project
~~~

When connecting to a remote host over SSH, allocate a TTY:

~~~sh
ssh -tt host 'tmux attach-session -t project'
~~~

Multiple clients can attach to one tmux session, so desktop terminal use and agentd-mediated mobile use can coexist. tmux attach is session-oriented; it does not replace the pane metadata or state detection managed by agentd.

### 8.4 tmux options and recovery

At startup, agentd scans tmux and rebuilds:

- agentd user options;
- session, window, and pane structure;
- cwd, command, and process information;
- saved Pane and Run records from SQLite.

Manually created panes and panes with incomplete metadata are shown as kind=shell or unknown.

A viewport lease has the following state flow:

~~~text
idle
  |-- mobile attach -> mobile-owned
       |-- desktop client-active/resized/focus-in -> desktop-owned
       |-- mobile claim/foreground -> mobile-owned
       |-- mobile disconnect -> snapshot restore
~~~

Only one mobile lease is created for a given window; an existing lease is not silently replaced. If simultaneous operation from multiple devices becomes necessary, a separate conflict policy is added at the plugin or attachment layer.

## 9. WebSocket protocol

Separate JSON control frames from binary terminal-byte frames. Do not convert terminal output to JSON or interpret ANSI at the WebSocket layer.

~~~text
Client -> attach { target, cols, rows }
Server -> ready { target, cols, rows }
Client -> binary terminal input
Server -> binary terminal output
Client -> resize { cols, rows }
Client -> detach
~~~

A future full management connection may add a replayable command/event protocol:

~~~text
Client -> hello { protocolVersion, clientId, resumeFrom }
Server -> snapshot { seq, panes, capabilities }
Server -> event { seq, type, data }
Client -> command { requestId, method, params }
Server -> response { requestId, result | error }
~~~

### Required properties

- The current `/events` stream is intentionally non-durable and sends only
  `session_updated` invalidation hints. Clients refetch on connect and
  reconnect instead of replaying events.
- A future durable event stream can add a monotonically increasing seq and
  replay from `resumeFrom` after disconnecting.
- requestId correlates command responses.
- Input and actions validate both authorization and the target pane.
- High-volume terminal output is batched as PTY bytes and applies WebSocket backpressure.
- On terminal reconnect, the current screen is redrawn from the tmux attach-session PTY. This is separate from management-event resumption.
- Drizzle types are not shared with the mobile app; only DTOs and schemas from packages/protocol are shared.

The design uses the type-safe idea behind tRPC. However, long-lived connections, event resumption, and binary terminal output require an explicit event protocol in addition to request/response calls.

### Current HTTP and event API

The current AgentdApp exposes:

~~~text
GET  /health
GET  /api/capabilities
GET  /api/terminals
GET  /api/workspaces
GET  /api/workspace-directories?path=<host-directory>
POST /api/workspaces              # register a directory, hooks, and worktree copy patterns
GET  /api/sessions
POST /api/sessions              # create a tmux session
GET  /api/panes?session=<name>
POST /api/panes                 # create a shell, codex, or claude pane
WS   /terminal                  # attach, input, resize, and detach
WS   /events                    # session invalidation notifications
~~~

The management event WebSocket intentionally sends no pane or session data. A
tmux change is published as a small `session_updated` event containing the
session name, a reason, and a monotonic process-local revision. Clients use it
to invalidate their TanStack Query entries and refetch the current state over
HTTP. The event stream is a hint rather than a durable log: clients refetch on
connect and reconnect, and the host-side monitor remains the source of truth.

agentd currently discovers changes with a short tmux reconciliation poll. This
also observes panes created directly from a desktop tmux client, without
requiring that client to use the Mobile Agent CLI.

The same monitor periodically reconciles the SQLite `panes` table. By default,
it polls tmux every 1 second, attempts orphan cleanup every 60 seconds, and
retains rows that have not been seen for 10 minutes. Cleanup is scoped to the
current tmux socket and is protected by the live pane IDs, so an active pane is
never removed merely because its metadata is old. The upsert is keyed by the
tmux server generation and pane ID; this prevents a pane ID reused after a
tmux-server restart from inheriting stale metadata.

An unavailable tmux server is not treated as an authoritative empty snapshot:
it advances neither the reconciliation baseline nor cleanup. This avoids
treating a temporary tmux outage as proof that every pane was deleted. A
healthy snapshot with no panes is authoritative for change detection but still
does not run cleanup; normal retention cleanup resumes once a healthy snapshot
with at least one pane is available. The intervals and retention window can be
overridden with `AGENTD_TMUX_POLL_INTERVAL_MS`,
`AGENTD_PANE_CLEANUP_INTERVAL_MS`, and `AGENTD_PANE_RETENTION_MS`.

### 9.1 Starting and resuming from an unmanaged shell

`agent run` and `agent resume` can be invoked from an arbitrary shell inside a
tmux pane; the pane does not need to have been created by agentd. The CLI
persists the logical `agent_sessions` record first, then uses the private
agentd Unix control socket to adopt the current `TMUX_PANE`. agentd validates
the session's current `executionId`, confirms that the pane exists in its tmux
server, writes stable tmux pane options, and immediately reconciles the pane
into SQLite. The CLI falls back to writing those options through the current
tmux socket only when the control socket is unavailable; agentd still validates
the association when it next polls. Outside tmux, the agent session remains
managed in SQLite but has no pane association.

The durable `agent_sessions` row and the live `panes.agent_session_id` link have
different lifetimes:

- normal completion, interruption, or a failed launch releases the active pane
  metadata, while the session record remains available for `resume` according
  to its normal lifecycle rules;
- a crash can leave tmux metadata behind, but reconciliation requires the
  metadata execution ID to match the current SQLite execution and requires an
  agent command; stale metadata on a returned shell is cleared;
- `resume` claims the execution with an atomic SQLite update, so concurrent
  resumes allow only one owner to proceed. The backend session ID and managed
  worktree remain the recovery source even if the original tmux pane has gone
  away;
- periodic pane cleanup removes only stale `panes` projections. It never
  deletes `agent_sessions`, so losing a tmux pane does not by itself destroy
  resumability.

POST /api/sessions and POST /api/panes resolve registered workspace IDs on the host and validate the selected directory against the configured roots. A legacy cwd is accepted only through the same policy check. Starting an agent pane delegates to the host-side agent command; the browser never executes arbitrary host commands directly.

### Workspace directory picker

Rather than auto-selecting every directory below a host root, the UI first browses directories allowed by agentd and explicitly registers the selected directory. `GET /api/workspaces` returns only registered workspaces; `GET /api/workspace-directories` exposes browse candidates. Registration also stores optional executable setup and cleanup script paths plus one relative worktree copy pattern per line. Patterns support `*` for one path segment and `**` for nested segments; matching unmanaged files, including ignored files, are copied to the same relative path in a new worktree. Copying happens after `git worktree add` and before the setup hook. Hook paths are resolved on the host and may live outside the repository, while the hook process runs with the generated worktree as cwd. The API returns stable workspace IDs; agentd resolves the path with realpath and verifies that it remains below an allowed root. The iOS Files picker selects files on the phone and must not be used to select a remote Mac workspace.

## 10. Persistence

Use SQLite and Drizzle for host-side persistence.

### Main tables

~~~text
workspaces
panes
runs
agent_sessions
agent_profiles
installed_plugins
devices
notification_preferences
event_offsets
audit_events
~~~

### Storage policy

- Store current state in SQLite. Agent lifecycle belongs to agent_sessions; registered workspace directories, their personal hook paths, and worktree copy patterns belong to workspaces.
- Persist important state transitions as an event history.
- Do not store every terminal output byte by default.
- Store only the latest capture or a short ring buffer when needed.
- tmux is the source of truth for live execution; SQLite is the source of truth for management metadata and recovery information.

## 11. Mobile application

### 11.1 Technology choice

Implement the web UI with React, TypeScript, and xterm.js, then wrap it with Capacitor when distributing an iOS app.

Reasons:

- retain the fast Vite and HMR web development loop;
- share agentd protocol types in TypeScript;
- use the WebSocket Web API;
- let xterm.js handle ANSI/VT, scrollback, selection, and mouse input as the terminal emulator;
- keep the UI focused on one pane, where a web implementation is a good fit;
- limit native work to Swift plugins and Widget Extensions.

React Native remains an option if terminal rendering or iOS-specific UI must be embedded as a native View. By keeping the UI and agentd protocol separate, xterm.js can later be replaced with a SwiftUI or native terminal implementation.

### 11.2 Screens

1. Pane Board
   - pane list;
   - agent name, Run name, workspace, and worktree;
   - running, waiting_input, waiting_approval, and failed states.
2. Pane Picker Overlay
   - simplified representation of the original tmux layout;
   - selecting a pane opens the one-pane view.
3. Pane View
   - terminal output rendered by xterm.js;
   - input and send controls;
   - resize;
   - agent-specific actions.
4. Open Pane
   - agent or shell;
   - name;
   - workspace;
   - whether and how to create a worktree;
   - profile;
   - new window, right split, or bottom split;
   - source pane for a split.
5. Settings
   - host connection;
   - notification rules;
   - plugins and profiles;
   - key management.

### 11.3 Swift responsibilities

- start, update, and end ActivityKit Live Activities;
- render WidgetKit home-screen widgets;
- share snapshots with widgets through an App Group;
- use Keychain and, when appropriate, biometric authentication;
- handle APNs tokens and notification actions that are not available through Capacitor;
- implement Capacitor's iOS plugins.

### 11.4 Live Activity

Use one aggregate Activity as the default instead of creating one Live Activity per pane.

~~~text
AgentBoardActivity
  waitingCount
  runningCount
  attentionPaneId
  attentionAgent
  attentionProject
  reason
  updatedAt
~~~

Trigger an alert or sound only when running changes to waiting_input or waiting_approval. Do not notify for ordinary output updates.

Actions from a Live Activity are limited to safe structured actions such as opening the app or confirming an already authorized Approve or Reject operation. Do not send arbitrary terminal strings directly from a Live Activity.

The WebSocket is for real-time foreground display, not for keeping an iOS background connection alive. Use APNs and ActivityKit push updates for background notifications.

## 12. Tailscale and connectivity

### Basic MVP topology

~~~text
Browser / Capacitor
      |
      v HTTPS / WSS
Tailscale Serve
      |
      v localhost
agentd: 127.0.0.1:4317
~~~

### Policy

- Use Tailscale ACLs as the first network boundary.
- The browser build must not require connection settings or credentials beyond a Serve URL.
- Store only non-sensitive settings such as the Serve URL, display name, and last-connected time in Web Storage.
- Do not bring private keys, SSH passwords, or pairing secrets into the browser build; keep them in the native Keychain when SSH is implemented.
- Never put a Tailscale administration API token on the iPhone.
- Treat SSH as a future adapter for bootstrap, starting Serve, recovery, or bastion routing. It is not part of the MVP.
- Even in a native SSH implementation, keep private keys in Keychain and out of the API client and web bundle.
- Verify in an early spike that Tailscale Serve supports HTTP upgrades and long-lived WebSocket connections in the target environment.
- `agent serve tailscale` configures a persistent agentd-only Serve route; `agent dev serve tailscale` starts the source Web/agentd stack and retargets the fixed local development route. Serve setup remains an external transport concern rather than agentd business logic.
- Verify Serve identity headers such as Tailscale-User-Login at the localhost agentd boundary and combine them with pairing and authorization.
- If Serve has an operational limitation, first consider SSH port forwarding to the same agentd API.

SSH does not start agentd. When agentd is already running and the phone can reach the host on the same tailnet, Serve is simpler. SSH becomes useful when, for example, the bastion visible to the phone and the workstation running agentd are different hosts and the bastion must open an SSH connection to the workstation.

Do not embed Tailscale itself in the mobile app initially. Prefer the official Tailscale iOS app and connect to a host already present in the tailnet.

### Browser connection profile

The browser connection profile stores only:

~~~ts
type BrowserConnectionProfile = {
  id: string
  name: string
  serveUrl: string
  updatedAt: string
}
~~~

`serveUrl` is a complete base URL, including an external port or path when one is configured. The mobile client must not store or discover the host's internal `AGENTD_PORT`: Tailscale Serve hides that port, and the development supervisor wires it into the Vite proxy. If a native SSH route is added later, its RouteProvider creates a local forwarded URL (which may contain an ephemeral port) and hands that URL to `AgentdClient` without changing the browser profile model.

localStorage or another Web Storage implementation is sufficient because no secret is stored. Tailscale authentication and ACLs remain in the Tailscale app and tailnet. agentd continues to bind to localhost. If Serve identity headers or pairing tokens are added later, keep them short-lived and do not turn them into long-lived browser secrets.

### Additional native responsibilities

The native app can use the browser build's Serve route without change. Only an SSH-enabled build adds this thin adapter:

~~~text
SSH RouteProvider
  |-- obtain a key reference from Keychain
  |-- start local forwarding from bastion to the agentd host
  |-- generate localhost httpBaseUrl / websocketUrl
  |-- close the forward and end secret use
~~~

This adapter returns connection URLs and does not depend on the agentd-client package. SSH dependencies do not enter the web bundle, Hono RPC, domain, or application packages.

## 13. Notifications

~~~text
agent plugin observation
        |
        v
agentd state transition
        |
        v
NotificationPolicy
        |-- WebSocket event
        |-- Live Activity update
        |-- APNs alert
        |-- local notification (foreground assistance)
~~~

Example notification states:

- waiting_input;
- waiting_approval;
- failed;
- completed, when enabled by the user;
- host or agentd disconnected.

Deduplicate notifications by runId and transitionId. Do not include secrets or complete agent output in notifications or Live Activities. Show only a short summary containing the agent name, workspace name, and reason.

## 14. Desktop experience

### Initial policy

Do not build a desktop native app initially. Combine:

- tmux attach from an existing terminal;
- the agent CLI;
- agent tui;
- tmux status-line integration;
- diagnostic commands such as agent doctor.

### TUI role

~~~sh
agent tui
agent pane list
agent pane focus --waiting
agent pane open --agent codex --worktree auto
agent config edit
agent plugin list
agent workspace list
agent doctor
~~~

The TUI connects to agentd through a Unix socket and uses the same use cases as mobile. It must not directly manipulate tmux or SQLite.

### Future desktop UI

Add desktop-web if these needs emerge:

- visual editing of pane layouts;
- searching execution and event history;
- listing and managing worktree creation and deletion;
- forms for notification rules and profiles;
- a system tray and global shortcuts.

Build it as a web UI first. Wrap it with Tauri only when system-tray or OS integration is needed. The desktop UI also uses the protocol package shared with mobile.

## 15. CLI commands

The currently implemented agent lifecycle commands read and write agent_sessions rather than a state file:

~~~sh
agent run <codex|claude> [OPTIONS] [-- BACKEND_ARGS...]
agent resume [--global] NAME [-- BACKEND_ARGS...]
agent list [--global] [--names|--json]
agent cleanup [--global] [--force] NAME
agent doctor [--verbose]
~~~

run associates the worktree, workspace copy patterns, workspace hooks, Claude session ID, and Codex Remote Control thread name and archive with one SQLite session. With --worktree, unmanaged files are copied first, then the setup hook runs; cleanup hooks run before the worktree is removed. With --no-worktree, stored workspace copy patterns and hooks are not run; use --setup-hook or --cleanup-hook explicitly when needed.

The following commands are planned as agentd and TUI extensions:

~~~sh
agent daemon start
agent daemon status
agent daemon stop

agent mobile serve --stdio
agent mobile status

agent pane list
agent pane open --agent codex --name review --worktree auto
agent pane open --shell
agent pane focus <pane-id>
agent pane send <pane-id> --text 'continue'
agent pane resize <pane-id> --cols 120 --rows 40
agent pane close <pane-id>

agent workspace list
agent workspace register

agent agent list
agent profile list
agent plugin list
agent plugin add <package-or-path>

agent tui
agent config get
agent config edit
agent doctor
~~~

Unimplemented commands such as agent mobile serve --stdio remain thin transport adapters. Business logic is delegated to the long-running agentd process.

## 16. Security

- Bind the WebSocket endpoint to localhost and use Tailscale Serve as the default route.
- Use Tailscale ACLs to control access by host and user.
- Store only non-sensitive settings such as the Serve URL in browser storage.
- If pairing tokens are added, issue and revoke them per device.
- Store device tokens, private keys, and refresh tokens in native Keychain or on the host; never include them in the web bundle.
- Never put complete agent output in Live Activities or notifications.
- Check authorization for sendInput, Approve, Reject, and similar operations against the target Run.
- Record important actions as audit events.
- Make the plugin trust requirement explicit because plugins can execute arbitrary code on the host.
- Isolate external plugins in JSONL/stdin child processes and manage timeout, crash, and restart behavior.
- Consider containers, OS sandboxing, or a dedicated host user for future sandboxing.

## 17. Non-functional requirements

### Connectivity

- The browser build connects through Tailscale Serve over HTTPS/WSS.
- WebSocket reconnects automatically with exponential backoff.
- State can be restored from a snapshot and event sequence.
- tmux panes can be rediscovered after agentd restarts.
- Unsent input is not queued without a bound while offline.

### Performance

- Do not send terminal output as an unbounded stream of tiny events.
- Prioritize the visible pane's output on mobile.
- Keep pane lists and state updates as lightweight JSON.
- Keep terminal output separate from state events.

### Testing

- Test Domain and Application without tmux.
- Run tmux adapter integration tests against fixture tmux sessions.
- Test AgentPlugin state transitions with per-agent output fixtures.
- Test WebSocket reconnect, duplication, loss, and sequence resumption.
- Verify Live Activity waiting transitions and notification sounds on a real device.

## 18. Implementation phases

### Phase 0: contracts and skeleton

- Turborepo and Bun workspace monorepo, with Node LTS reserved for the Web toolchain;
- Domain, Application, and Protocol packages;
- Pane, Run, and AgentState types;
- WebSocket frame schemas;
- minimal Plugin API v1;
- fake tmux and agent fixtures.

### Phase 1: host MVP

- agentd start, stop, and status;
- browser connection settings through Tailscale Serve;
- viewport monitoring through tmux hooks and client polling, with Control Mode management as the next step;
- shell-pane display, input, and resize through Bun.Terminal and tmux attach-session -f active-pane;
- viewport lease with mobile zoom, desktop takeover, and size/layout restoration;
- xterm.js mobile viewport;
- SQLite and Drizzle;
- agent pane list CLI and Pane Board;
- tmux restart recovery.

### Phase 2: desktop TUI

- agent tui;
- waiting-pane list;
- attach or switch-client after pane selection;
- plugin, profile, and workspace management;
- tmux status-line integration.

### Phase 3: mobile proof of concept

- Web and xterm.js, optionally packaged as iOS with Capacitor;
- browser connection settings for saving and switching Serve URLs;
- WSS connection;
- one-pane display;
- keyboard, selection, copy, and scroll;
- pane list and overlay.

### Phase 4: notifications and iOS extensions

- Swift Capacitor plugin;
- aggregate ActivityKit Live Activity;
- WidgetKit snapshot;
- Keychain;
- APNs notifications.

### Phase 5: agent extensions

- shell plugin;
- Codex plugin;
- Claude plugin;
- declarative profiles;
- external JSONL plugins;
- plugin doctor and permission display.

### Phase 6: desktop UI, only if needed

- desktop web UI;
- event history, layouts, and settings forms;
- Tauri wrapper, tray, and global shortcut.

### Phase 7: future bastion SSH route

- native SshRouteProvider;
- local port forwarding from bastion to the agentd host;
- Keychain references, connection diagnostics, and reliable cleanup;
- integration tests using the same HTTP/WebSocket contract as Serve.

## 19. Main risks and decision points

| Risk | How to decide | Response |
|---|---|---|
| Tailscale Serve is unstable for WebSocket | Test long-lived connections and reconnects from a real device | SSH port forwarding or another proxy |
| Terminal interaction is uncomfortable in WKWebView | Test xterm.js IME, selection, and external keyboards first | Replace the terminal portion with SwiftUI or native code |
| Agent waiting-state detection is unreliable | Investigate structured event support | AgentPlugin observer plus fallback parser |
| Live Activity APIs are insufficient | Build an aggregate Activity proof of concept | Implement a Swift extension |
| External plugins require too many privileges | Show permissions in install and doctor flows | Child process, dedicated user, or sandbox |
| tmux and agentd state diverge | Test restart, manual changes, and pane movement | tmux options plus recovery scan |
| High output volume makes mobile slow | Measure large logs and long connections | Batching, rate limits, and capture separation |

## 20. References

- [tmux Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
- [Tailscale identity headers](https://tailscale.com/docs/concepts/tailscale-identity)
- [Creating Capacitor plugins](https://capacitorjs.com/docs/plugins/creating-plugins)
- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)
- [React Native Turbo Modules with Swift](https://reactnative.dev/docs/the-new-architecture/turbo-modules-with-swift)
- [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/)
- [Capacitor Live Activities](https://github.com/Cap-go/capacitor-live-activities)
- [Capacitor WidgetKit](https://github.com/Cap-go/capacitor-widget-kit)
- [Mobilecode-open: Capacitor and Tailscale Serve example](https://github.com/elkir0/Mobilecode-open)

## 21. Dependency policy

- Before adding or updating a dependency, verify the public stable npm release and the project's official release information.
- Do not use alpha, beta, or release-candidate versions unless there is an explicit adoption reason.
- After an update, run bun run deps:check, bun run typecheck, bun run test, and bun run build.
- If the latest versions are incompatible, do not silently pin an older version. Consider a replacement library or a platform feature and record the reason in the architecture documentation.
