# Mobile Agent / agentd 設計・仕様書

最終更新: 2026-08-10
ステータス: 実装ベースライン + 継続設計

## 1. 概要

Mobile Agentは、開発ホスト上で動作する`agentd`と、iPhoneから接続するモバイルUIで、tmuxペイン単位のエージェント実行環境を管理するためのシステムである。

主な目的は、デスクトップのtmux環境を壊さずに、iPhoneから次の操作をできるようにすること。

- ペイン単位でエージェントやシェルを一覧・選択する
- 1ペインだけをモバイル向けに表示する
- エージェント名、プロジェクト、worktree、状態を確認する
- 入力待ち・承認待ちのペインを見つける
- ペインへ入力を送る、リサイズする、停止する
- 入力待ちへの遷移を通知・Live Activityで知らせる
- 任意のエージェントツールをプラグインで追加する

### 決定事項

- ホスト側の常駐プロセスはTypeScript/Node.jsの`agentd`とする
- `agentd`のHTTP APIはHonoで実装し、`createAgentdApp(deps)`がDI済みのHono appを返す。プロセス起動、SQLite、tmux、PTY、WebSocketはこの外側で構成する
- `ReturnType<typeof createAgentdApp>`を`AgentdApp`として公開し、`@mobile-agent/agentd-client`のHono RPC clientからWeb/Capacitor/React Nativeへ共有する
- モバイルのAPI client、接続状態管理、WebSocket、xterm.js連携はTypeScriptで統一する。SSH port forwardingだけは必要に応じてnative bridgeが接続を作り、TypeScript clientへURLを渡す
- `agent` CLIも同じリポジトリで管理し、SQLiteをライフサイクル状態の唯一の正規状態源にする
- dotfiles側の旧`.state`形式は互換対象にせず、移植後のSQLiteモデルを前提に実装する
- ペインの実体はtmuxに置き、端末表示はPTY経由の`tmux attach-session`、管理・監視はtmux Control Modeで行う
- ペイン識別子はtmuxの`%12`などに依存せず、独自のUUIDを持つ
- エージェントの状態はプラグインが正規化し、モバイルUIは共通状態だけを扱う
- ホストとモバイルの通信はHTTP API + WebSocketを基本とし、ブラウザ版の標準経路はTailscale Serveとする
- ブラウザ版はServe接続設定だけを保存し、SSH秘密鍵・パスワード・Keychainへアクセスしない
- SSHは踏み台ホストとagentdホストが異なる場合などの将来経路として、`RouteProvider`の追加実装に閉じ込める
- モバイルUIはReact/TypeScript + xterm.jsを中心にWebとして実装し、必要に応じてCapacitorでiOSアプリ化する
- MVPではPCとモバイルが同じtmux paneを共有し、モバイル接続中だけ`TmuxViewportLease`がviewport ownerになる
- モバイルclientは`active-pane`付きでattachし、ペイン選択はclient単位に分離する。zoomとwindowサイズはwindow単位なので、モバイル操作中にPC側が狭くなることは仕様とする
- viewport lease取得時は既存のPC clientにも一時的に`active-pane`を付与し、モバイル側のpane選択がPC clientへ波及しないようにする。lease終了時に元のclient flagへ戻す
- PCの`client-active`、`client-resized`、利用可能なら`client-focus-in`を検知し、desktop ownerへ戻してzoom/layout/サイズを復元する
- 既存PC clientのpaneはlease取得前のactive paneを基準に復元し、PC clientが存在しない間は後からattachしたclientの操作をdesktop takeoverとして扱う
- ツイン方式やagentごとの独立Runは、同時操作や独立サイズが必要なplugin向けの将来拡張とする
- Live Activity、Widget、KeychainなどのOS拡張はclient本体の必須依存にせず、必要になった時点で薄いnative bridgeとして追加する
- デスクトップ側はまず既存ターミナル、tmux attach、TUIを利用する
- デスクトップGUIは必要性が見えてからWeb UI/Tauriとして追加する

## 2. スコープ

### 対象

- macOS/Linuxなどの開発ホスト
- tmux上で動作するAIエージェント、通常のシェル、任意のコマンド
- iPhoneからの1ペイン表示・入力・状態確認
- Tailscaleネットワーク内での安全な接続
- SQLiteによるホスト側の設定・実行履歴管理
- Codex、Claude Codeなどを含むエージェントプラグイン

### 初期リリースで対象外とするもの

- iPhone上でのTailscale VPNクライアントの完全な内蔵
- デスクトップGUIによるフルターミナルエミュレーターの再実装
- Live Activityからの任意のターミナル入力
- すべてのエージェントの出力を完全に画面解析だけで判定すること
- 信頼できない第三者プラグインの完全なサンドボックス実行

## 3. 用語とドメインモデル

### Host

tmux、エージェント、`agentd`が動作する開発マシン。SQLiteもホスト側に置く。

### Session

tmuxのセッション。人間が`tmux attach`で接続する単位。Mobile Agentの管理単位ではない。

### Pane

tmux上のペイン。Mobile Agentが一覧・選択する基本単位。

### Run

ペイン内で実行されている論理的な作業単位。1つのペインを再利用して複数のRunを実行できる。

### AgentPlugin

特定のエージェントツールを起動し、出力やイベントを共通の状態へ変換するホスト側プラグイン。

### Profile

既存プラグインの起動コマンド、環境変数、検出ルール、通知ルールなどを上書きする設定。

### Workspace

プロジェクトの作業ディレクトリ。通常の作業ディレクトリ、git worktree、その他の作業環境を含む。

### PaneとRunの分離

tmuxペインは長く存在し、Runはペイン内で入れ替わる。そのため、ペインとエージェントを直接1対1で保存しない。

```text
Pane
  id: mobile-pane-uuid
  tmuxPaneId: %12
  session: project
  window: 0
  currentRunId: run-uuid

Run
  id: run-uuid
  kind: agent | shell
  agentId: codex | claude | custom | null
  name: string
  projectId: string | null
  workspaceId: string | null
  state: starting | running | waiting_input | waiting_approval |
         completed | failed | shell | unknown
```

通常のシェルは`kind=shell`、`agentId=null`として同じモデルで扱う。

tmuxのペインIDは再生成や移動で変化する可能性があるため、`mobilePaneId`を主キーとする。tmux側には次のようなuser optionを保存し、agentd再起動後の復元に利用する。

```text
@agentd.pane_id
@agentd.pane_name
@agentd.kind
@agentd.run_id
@agentd.agent_id
@agentd.project_id
@agentd.workspace_id
@agentd.profile_id
```

## 4. 全体アーキテクチャ

```text
                              ┌─────────────────────┐
                              │ iPhone              │
                              │ TypeScript client   │
                              │ Web + xterm.js      │
                              │ Capacitor shell     │
                              └─────────┬───────────┘
                                        │ HTTPS / WSS
                    Tailscale Serve (標準) / SSH forwarding (将来)
                                        │
┌───────────────────────────────────────▼──────────────────────────┐
│ 開発ホスト                                                       │
│                                                                  │
│  ┌──────────────┐     ┌───────────────────────────────────────┐  │
│  │ agent CLI/TUI│────▶│ agentd                                │  │
│  └──────────────┘     │                                       │  │
│                       │ Hono HTTP / WebSocket / PTY             │  │
│  desktop terminal    │ Domain / Application / Ports            │  │
│  ── tmux attach ────▶│ Plugin manager / recovery               │  │
│                       └──────────┬───────────────┬────────────┘  │
│                                  │               │                │
│                    tmux Control Mode / PTY   SQLite/Drizzle      │
│                                  │               │                │
│                         tmux sessions/panes  config/history      │
└──────────────────────────────────────────────────────────────────┘
```

`agentd`はビジネスロジックの唯一の実行主体とする。CLI、TUI、WebSocket、将来のDesktop UIは、すべて同じApplication Use Caseを呼び出す。

## 5. リポジトリ構成案

```text
apps/
  agent-cli/              # agentコマンド、CLI、TUI
  agentd/                 # 常駐プロセス
  web/                    # React + xterm.js。Capacitorからも利用するUI
  desktop-web/            # 将来のデスクトップWeb UI

packages/
  agentd-client/          # Hono RPC、HTTP DTO検証、WebSocket client
  domain/                 # エンティティ、値オブジェクト、状態機械
  application/            # Use Case、ポート
  protocol/               # WebSocket DTO、イベント、Zod schema
  persistence/            # SQLite、Drizzle
  tmux/                   # tmux Control Mode adapter
  agents/                 # AgentPlugin APIと組み込みプラグイン
  workspaces/             # project/worktree adapter
  notifications/          # NotificationPort実装
  tailscale/              # Serve/identity/bootstrap補助
  config/                 # config読み込み・検証

ios/
  MobileAgentNative/      # SSH port forwarding bridge（必要な場合のみ）
  MobileAgentWidget/      # 将来のOS拡張。client本体からは分離

docs/
  architecture.md
  research/               # tmux個別pane描画などの継続調査
```

ドメイン層はtmux、SQLite、WebSocket、Capacitorを直接参照しない。各実装はポートを介して接続する。

### agentd HTTP appとDI

`createAgentdApp`はプロセスを起動せず、HTTP APIの依存だけを受け取ってHono appを構築する。

```text
createAgentdServer()
  ├─ SQLite / Drizzle
  ├─ TmuxAdapter
  ├─ TmuxViewportManager
  ├─ application use cases
  └─ createAgentdApp({ ...deps })
        └─ AgentdApp = ReturnType<typeof createAgentdApp>

@mobile-agent/agentd-client
  └─ hc<AgentdApp>(connection.httpBaseUrl)
```

Tailscale ServeとSSH port forwardingは、どちらも同じagentd APIへ到達するための接続経路である。API clientやユースケースは経路を意識しない。ブラウザ版にはSSH adapterを含めず、Serve routeだけを公開する。

```text
Browser / Serve:  https://host.tailnet/... ─┐
Native / Serve:   https://host.tailnet/... ──┼─ AgentdClient
Native / SSH:     http://127.0.0.1:xxxxx ───┘  (将来)
                                                ├─ HTTP API
                                                └─ terminal WebSocket
```

### 接続経路の責務

```ts
type AgentdRoute = {
  kind: "serve" | "same-origin" | "lan" | "ssh"
  httpBaseUrl: string
  websocketUrl: string
  close?: () => Promise<void>
}
```

- `serve`: ブラウザ・Capacitorの標準経路。HTTPS/WSS、Tailscale ACL、Serveのネットワーク境界を利用する
- `same-origin`: Vite proxyやagentdと同一originでの開発経路。公開環境の標準設定にはしない
- `lan`: 将来の明示的なLAN接続経路。TLS、認証、CORS、端末発見を別途設計する
- `ssh`: 将来のネイティブ専用経路。踏み台からagentdホストへのport forwardingを作り、ローカルURLを返す

`AgentdClient`は`AgentdRoute`を受け取るだけで、経路の確立・秘密情報・Tailscale CLI・SSHを参照しない。経路の確立はWebまたはnative側の`RouteProvider`が担当する。agentdの起動も経路の責務ではなく、launchd/systemdまたは明示的なbootstrapコマンドで管理する。

agentdは単発CLIではなく、tmux・agent plugin・SQLiteを同じホストで管理する常駐control-plane daemonである。`agentd`という名前は、Unix系の常駐サービスを表す`d`の慣習にも合い、`agent` CLIと役割を分けられるため適切とする。

## 6. Clean / Hexagonal Architecture

```text
Adapters
  CLI / TUI / WebSocket / PTY / SSH / tmux / SQLite / APNs
                         │
                         ▼
Application Use Cases
  ListPanes
  OpenPane
  ClosePane
  SendInput
  ResizePane
  SubscribePaneEvents
  CreateWorkspace
  ConfigureAgent
  AcknowledgeWaiting
                         │
                         ▼
Domain
  Pane / Run / Workspace / AgentState / Plugin / Event
                         │
                         ▼
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
```

### Application Use Caseの原則

- CLIとモバイルで同じUse Caseを使う
- WebSocket handlerに業務ロジックを書かない
- TUIがSQLiteを直接更新しない
- tmuxの管理出力をそのまま外部APIへ露出せず、共通イベントへ変換する。端末表示経路のPTYバイト列は別のデータプレーンとして扱う
- コマンドは可能な限りidempotentにする
- 外部イベントは`seq`を持ち、再接続後に再開できるようにする

### Webの実装規約

TanStack Routerのファイルベースルーティングを使い、feature単位で次の3ファイルを基本形にする。

```text
feature/
  pane-viewmodel.ts  # ViewModelのinterfaceとusePaneViewModel
  pane-view.tsx      # ViewModelをpropsで受け取る純粋なView
  pane-view.stories.tsx
```

`route.tsx`は`useHogeViewModel`を呼び、パス・search paramsを処理してViewへ渡すだけにする。ViewModelは単体テスト、ViewはStorybookのstate storyで網羅する。

サーバー状態の一覧、Runメタデータ、設定、mutationにはTanStack Queryを使う。一方、PTY/WebSocketの端末バイト列、接続状態、xterm.jsのインスタンスはQueryのキャッシュに入れず、ViewModelと端末transportのライフサイクルで管理する。

### バックエンドのテスト規約

Domain、Application、adapter、protocolのテストはtable testを基本にし、正常系・異常系で同じ実行形を使う。

```ts
type TestCase<When, Result, Context> = {
  given: () => Promise<unknown> | unknown
  when: (given: unknown) => When
  check: Array<(result: Result) => Promise<unknown> | unknown>
  assert: Array<(context: Context) => void>
}
```

共通runnerが`given → when → check（ctxへ格納）→ assert`を実行する。外部adapterのfixtureも同じ形式にし、テスト対象のact部分をケースごとに重複させない。

## 7. AgentPlugin設計

### 7.1 拡張の二段構成

#### 宣言型Profile

コードを書かずに既存エージェントの動作を変更する。

- 起動コマンド、引数、cwd
- 環境変数
- プロジェクト/worktreeの選択方法
- 出力に対する状態判定ルール
- 通知対象の状態
- 起動時に送る初期入力
- 利用可能なアクション

```yaml
profiles:
  mobile-codex:
    extends: codex
    command: codex
    args: ["--profile", "mobile"]
    env:
      AGENTD_RUN_ID: "${run.id}"
    notifications:
      states: [waiting_input, waiting_approval, failed]
```

#### Code Plugin

任意のTypeScriptコードで、独自のエージェントや高度な状態解析を実装する。

```ts
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
```

プラグインが返すのは、次のような正規化された観測結果とする。

```ts
type AgentObservation =
  | { type: "state_changed"; state: AgentState; reason?: string }
  | { type: "title_changed"; title: string }
  | { type: "progress"; value?: number; message?: string }
  | { type: "action_requested"; action: ActionDescriptor }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
```

### 7.2 状態検出の優先順位

1. エージェントが提供する構造化イベント、JSONL、App Server、WebSocket
2. エージェントプロセスの終了、シグナル、標準ストリーム
3. tmux/PTY出力の状態パーサー
4. Profileで定義した正規表現ルール
5. ユーザーによる手動状態変更

画面文字列の解析はエージェントのUI変更に弱いため、組み込みプラグインでも構造化イベントを優先する。

### 7.3 プラグインの実行方式

- 組み込み・信頼済みプラグイン: agentdプロセス内のTypeScript module
- 自作・他言語プラグイン: 子プロセスをJSONL/stdinで起動
- プラグインのインストール先: npm package、リポジトリ内package、ユーザーのXDG config配下
- モバイルアプリにはプラグインコードを配布しない
- プラグインはtmuxやSQLiteを直接操作せず、agentdが提供するContext/Portを利用する

外部プラグインはクラッシュの影響をagentd本体から分離できる。一方、ホスト上でコマンド実行やファイル読み取りができる場合、完全なサンドボックスではない。インストール時には信頼境界を明示する。

### 7.4 CLI

```sh
agent plugin list
agent plugin add npm:@example/agent-plugin
agent plugin enable example
agent plugin doctor example

agent agent list
agent profile list
agent profile create mobile-codex --extends codex
```

## 8. tmux連携

### 8.1 管理・監視経路

agentdはtmux Control Modeを管理・監視に利用する。

- `%output`などのペイン出力イベントを受け取る
- ペインIDを指定して入力・リサイズ・選択を行う
- ペイン生成・終了・移動を監視する
- 必要に応じて`capture-pane`で状態確認や復旧を行う

ただし、初期のモバイル端末表示はControl Modeのイベントを直接画面へ投影しない。端末の画面状態を正しく解釈する責務はxterm.jsへ寄せる。

### 8.2 モバイル端末データ経路

モバイルの1ペイン表示は、agentdがPTYを作成して、同じtmux sessionへ`active-pane`付きのclientとして`tmux attach-session`する。

```text
xterm.js ⇄ WebSocket ⇄ agentd ⇄ node-pty ⇄ tmux attach-session -t <target>
```

- PTYから出た端末バイト列は、agentdが意味解釈せずWebSocketのバイナリフレームで転送する
- xterm.jsがANSI/VTシーケンス、alternate screen、カーソル、スクロールバック、選択を解釈する
- WebSocketのテキストフレームは`attach`、`resize`、`detach`などの制御に限定する
- xterm.jsの`cols/rows`をPTYへ返し、TUIをスマホ画面幅で実行する
- モバイル接続時は対象windowの`window-size`を一時的に`manual`へ変更し、スマホのサイズを明示的に`resize-window`へ反映する
- `active-pane`によりモバイル側のactive paneはPC clientのactive paneと分離する
- `resize-pane -Z`のzoomとwindowサイズはwindow単位なので、モバイル操作中にPC側が小さくなることは許容する
- agentdはviewport取得時にlayout、zoom、active pane、windowサイズ設定、実サイズをsnapshotする
- PC clientの操作を検知したらmobile ownerをdesktop ownerへ遷移させ、対象windowをPCサイズへ戻す
- モバイル切断時、PC takeover前ならsnapshotを完全復元し、takeover後ならPC側の変更を優先して古いsnapshotを上書きしない

PC操作の検知は、agentdがtmux hookを登録し、localhostの内部HTTP endpointへ通知する方式を基本とする。hookが登録できない環境では、agentdのclient監視pollingをfallbackとして使う。フォーカスイベントは端末側の対応に依存するため、キー入力またはリサイズも必ず復帰トリガーにする。

### 8.3 デスクトップからの連携

既存の端末からは通常どおり操作できる。

```sh
tmux attach-session -t project
```

リモートホストへSSH接続してから接続する場合は、TTYを割り当てる。

```sh
ssh -tt host 'tmux attach-session -t project'
```

同じtmuxセッションへ複数クライアントが接続できるため、デスクトップの端末とagentd経由のモバイル操作は併存できる。ただし、`tmux attach`はセッション単位であり、agentdが持つペインのメタデータや状態判定を置き換えるものではない。

### 8.4 tmux optionと復旧

agentd起動時にtmuxをスキャンし、次の情報を再構成する。

- `@agentd.*` user option
- session/window/pane構造
- cwd、command、process
- 保存済みSQLiteのPane/Run情報

手動で作られたペインや情報が不完全なペインは`kind=shell`または`unknown`として表示する。

viewport leaseは次の状態を持つ。

```text
idle
  └─ mobile attach → mobile-owned
       ├─ PC client-active/resized/focus-in → desktop-owned
       ├─ mobile claim/foreground → mobile-owned
       └─ mobile disconnect → snapshot restore
```

同じwindowに対して同時に複数のmobile leaseは作らず、既存leaseを壊さない。複数デバイス同時操作が必要になった場合は、別の競合ポリシーをplugin/attachment層で追加する。

## 9. WebSocketプロトコル

JSONの制御フレームと、端末バイト列を載せるバイナリフレームを分離する。端末出力をJSONへ変換したり、WebSocket層でANSIを解釈したりしない。

```text
Client → attach { target, cols, rows }
Server → ready { target, cols, rows }
Client → binary terminal input
Server → binary terminal output
Client → resize { cols, rows }
Client → detach
```

将来の管理接続では、次のイベントプロトコルを別途追加する。

```text
Client → hello { protocolVersion, clientId, resumeFrom }
Server → snapshot { seq, panes, capabilities }
Server → event { seq, type, data }
Client → command { requestId, method, params }
Server → response { requestId, result | error }
```

### 必須要件

- すべてのイベントに単調増加する`seq`を付ける
- 切断後に`resumeFrom`から再送できるようにする
- `requestId`でコマンド応答を対応付ける
- 入力・アクションは権限と対象ペインを検証する
- 高頻度の端末出力はPTYバイト列として適切にバッチ化し、WebSocketのbackpressureを扱う
- 端末の再接続時は、まず`tmux attach-session`のPTYから現在画面を再描画する。管理イベントのresumeとは別の仕組みとする
- SQLiteのDrizzle型をモバイルへ共有せず、`packages/protocol`のDTO/schemaだけを共有する

tRPCのような型安全な発想は採用する。ただし、長時間接続、イベント再開、バイナリ出力を扱うため、通常のrequest/responseだけでなくイベントプロトコルを明示的に設計する。

### 現行HTTP API

`AgentdApp`が現在公開するHTTP APIは次の通り。HTTPのDTOと入力検証は`packages/protocol`、clientは`packages/agentd-client`に集約する。

```text
GET  /health
GET  /api/capabilities
GET  /api/terminals
GET  /api/sessions
POST /api/sessions              # tmux sessionを作成
GET  /api/panes?session=<name>
POST /api/panes                 # shell / codex / claude paneを作成
WS   /terminal                  # attach / input / resize / detach
```

`POST /api/panes`はcwdの存在、sessionの存在、agent/shellとagentIdの整合性をagentd側で検証する。agent paneの起動はホスト側の`agent` commandへ委譲し、ブラウザは任意のホストコマンドを直接実行しない。

### Workspace directory picker（次段階）

workspaceのdirectoryは、モバイルからホストの絶対パスを直接入力させるより、agentd側で管理するworkspace rootを起点に選択させる。候補は次の順で提供する。

- 最近使ったworkspace、favorite、現在のsessionのcwd
- Git repository rootと、その配下のdirectory
- `AGENTD_WORKSPACE_ROOTS`またはSQLiteで許可したroot配下のdirectory

APIはパス文字列ではなくworkspace/directory IDを返し、agentdが`realpath`後に許可rootから脱出していないことを検証する。UIは「最近使ったもの」「Git projects」「フォルダを開く」の3段階にし、検索とbreadcrumbで深いdirectoryを選べるようにする。iOSのFiles pickerはiPhone側のファイルを選ぶ機能なので、リモートMacのworkspace選択には使わない。

## 10. Persistence

SQLite + Drizzleをホスト側の永続化に使う。

### 主なテーブル

```text
projects
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
```

### 保存方針

- 現在状態はSQLiteに保存する。agent lifecycleは`agent_sessions`、workspace/project定義は`workspaces`/`projects`で管理する
- 重要な状態遷移はイベント履歴として保存する
- ターミナル出力の全バイト列は原則保存しない
- 必要に応じて最新のcaptureや短いring bufferだけを保存する
- tmuxが実行状態のsource of truth、SQLiteは管理メタデータと復旧情報のsource of truthとする

## 11. モバイルアプリ

### 11.1 技術選定

Web UIはReact/TypeScript + xterm.jsで実装し、iOSアプリとして配布するときはCapacitorでラップする。

理由:

- Vite/HMRによるWeb開発の快適さを維持できる
- `agentd`のprotocol型をTypeScriptで共有できる
- WebSocketはWeb APIで利用できる
- xterm.jsがANSI/VT、スクロール、選択、マウス入力を端末エミュレーターとして担当できる
- UIが1ペイン中心で、Web UIでも成立しやすい
- ネイティブ処理をSwift pluginとWidget Extensionに限定できる

React Nativeは、ターミナル描画やiOS固有UIをネイティブViewとして組み込みたくなった場合の候補とする。現時点では、UIとagentd protocolを分離しておけば、xterm.jsをSwiftUI/native terminalへ差し替えられる。

### 11.2 画面構成

1. Pane Board
   - ペイン一覧
   - agent名、run名、プロジェクト、worktree
   - running / waiting_input / waiting_approval / failedの表示
2. Pane Picker Overlay
   - tmuxの元レイアウトを簡略化して表示
   - ペインを選択すると1ペイン画面へ遷移
3. Pane View
   - xterm.jsによるターミナル出力
   - 入力欄・送信
   - リサイズ
   - agent固有アクション
4. Open Pane
   - agentまたはshell
   - name
   - project
   - worktreeの有無・作成方法
   - profile
   - `new window`、既存paneの右分割、下分割
   - 分割時の基準pane
5. Settings
   - host接続
   - 通知ルール
   - plugin/profile
   - キー管理

### 11.3 Swiftで担当する部分

- ActivityKitのLive Activity開始・更新・終了
- WidgetKitのホーム画面Widget
- App GroupによるWidgetとのスナップショット共有
- Keychain、必要に応じて生体認証
- APNs tokenや通知アクションの不足部分
- Capacitor pluginのiOS実装

### 11.4 Live Activity

ペインごとにLive Activityを作らず、1つの集約Activityを基本とする。

```text
AgentBoardActivity
  waitingCount
  runningCount
  attentionPaneId
  attentionAgent
  attentionProject
  reason
  updatedAt
```

`running → waiting_input`や`running → waiting_approval`の遷移時だけalert/soundを発生させる。通常の出力更新では通知しない。

Live Activityから実行するアクションは、アプリを開く、確認済みのApprove/Rejectなど安全な構造化アクションに限定する。任意のターミナル文字列を直接送らない。

WebSocketはフォアグラウンド時のリアルタイム表示用であり、iOSバックグラウンドの接続維持手段とはしない。バックグラウンド通知はAPNs/ActivityKit pushを使う。

## 12. Tailscaleと接続

### 基本構成（MVP）

```text
Browser / Capacitor
      ↓ HTTPS / WSS
Tailscale Serve
      ↓ localhost
agentd: 127.0.0.1:4317
```

### 方針

- Tailscale ACLを最初のネットワーク境界とする
- ブラウザ版はServe URL以外の接続設定やクレデンシャルを要求しない
- Serve URL、表示名、最後に接続した日時などの非機密設定だけをWeb Storageへ保存する
- 秘密鍵、SSH password、pairing secretなどはブラウザ版へ持ち込まず、SSH実装時のnative Keychainへ限定する
- iPhoneにTailscale管理API tokenを持たせない
- SSHは初回bootstrap、Serve起動、復旧、踏み台経路が必要な場合の将来adapterとする。MVPでは実装しない
- SSH秘密鍵はnative実装時もKeychainを使い、API clientやWeb bundleには含めない
- Tailscale ServeのHTTP upgradeと長時間WebSocketが実環境で動くか、初期spikeで確認する
- 現行は`tailscale serve --bg 4317`などの管理方式を利用できる。Serve起動をCLIへ統合する場合も、業務ロジックはagentdへ委譲する
- Serveのidentity header（`Tailscale-User-Login`など）をlocalhostのagentdで検証し、pairing token/権限と組み合わせる
- Serveで問題がある場合の代替候補は、まず同じagentd APIを通すSSH port forwardingとする

SSHはagentdを起動する仕組みではない。agentdがすでに稼働している場合、同一tailnet上ではServeが単純である。SSHが必要になるのは、たとえばスマホから見える踏み台`bastion`とagentdが動く`workstation`が異なり、`bastion`から`workstation`へSSH接続する場合である。

Tailscale自体をモバイルアプリへ内蔵することは初期対象外とする。公式Tailscale iOSアプリを利用し、iPhoneからtailnet内のホストへ接続する方式を優先する。

### ブラウザ版の接続設定

ブラウザ版の接続プロファイルは次の情報だけを保存する。

```ts
type BrowserConnectionProfile = {
  id: string
  name: string
  serveUrl: string
  updatedAt: string
}
```

保存先は`localStorage`などのWeb Storageでよい。秘密情報を保存しないため、Keychain相当の機能は不要である。Tailscaleの認証・ACLはTailscaleアプリとtailnet側に置き、agentdはlocalhost bindを維持する。将来、Serve identity headerやpairing tokenを導入する場合も、ブラウザへ長期秘密を渡さず短命セッションとして扱う。

### ネイティブ版の追加責務

ネイティブ版はブラウザ版のServe経路をそのまま利用できる。SSHを有効にした場合だけ、次の薄いadapterを追加する。

```text
SSH RouteProvider
  ├─ Keychainから鍵参照を取得
  ├─ bastion → agentd hostのlocal forwardを開始
  ├─ localhostのhttpBaseUrl / websocketUrlを生成
  └─ closeでforwardと秘密情報の利用を終了
```

このadapterは`@mobile-agent/agentd-client`へ依存せず、接続URLだけを返す。Web bundle、Hono RPC、domain、applicationにはSSH依存を入れない。

## 13. 通知

```text
agent plugin observation
        ↓
agentd state transition
        ↓
NotificationPolicy
        ├─ WebSocket event
        ├─ Live Activity update
        ├─ APNs alert
        └─ local notification（フォアグラウンド補助）
```

通知対象の例:

- `waiting_input`
- `waiting_approval`
- `failed`
- `completed`（ユーザー設定で有効化）
- ホストまたはagentdの切断

通知は`runId + transitionId`で重複排除する。通知・Live Activityには秘密情報やエージェント出力全文を含めず、agent名・プロジェクト名・理由の短い要約だけを表示する。

## 14. デスクトップ体験

### 初期方針

デスクトップネイティブアプリは作らず、次を組み合わせる。

- 既存ターミナルからの`tmux attach`
- `agent` CLI
- `agent tui`
- tmux status line連携
- `agent doctor`などの診断コマンド

### TUIの役割

```sh
agent tui
agent pane list
agent pane focus --waiting
agent pane open --agent codex --project mobile-agent --worktree auto
agent config edit
agent plugin list
agent workspace list
agent doctor
```

TUIはagentdのUnix socketへ接続し、モバイルと同じUse Caseを利用する。tmuxやSQLiteを直接操作する実装にはしない。

### 将来のDesktop UI

次の需要が出た場合に、`desktop-web`を追加する。

- ペインレイアウトの視覚的な編集
- 実行履歴・イベント履歴の検索
- worktree作成・削除の一覧操作
- 通知ルールやprofileのフォーム編集
- システムトレイ、グローバルショートカット

まずWeb UIとして作り、システムトレイやOS統合が必要になったらTauriでラップする。デスクトップUIもモバイルと同じ`packages/protocol`を使う。

## 15. CLIコマンド

現在実装しているagent lifecycleコマンドは次の通り。state fileを経由せず、すべて`agent_sessions`を読み書きする。

```sh
agent run <codex|claude> [OPTIONS] [-- BACKEND_ARGS...]
agent resume [--global] NAME [-- BACKEND_ARGS...]
agent list [--global] [--names|--json]
agent cleanup [--global] [--force] NAME
agent project list [--json]
agent doctor [--verbose]
```

`run`はworktree、project hook、Claude session ID、Codex Remote Controlのthread name/archiveまで一つのSQLite sessionに紐付ける。`--no-worktree`では暗黙のproject hookを実行せず、必要な場合だけ`--setup-hook`/`--cleanup-hook`で明示する。

以下はagentd/TUIを拡張するときのコマンド案。

```sh
agent daemon run
agent daemon status
agent daemon stop

agent mobile serve --stdio
agent mobile status

agent pane list
agent pane open --agent codex --name review --project repo --worktree auto
agent pane open --shell --project repo
agent pane focus <pane-id>
agent pane send <pane-id> --text 'continue'
agent pane resize <pane-id> --cols 120 --rows 40
agent pane close <pane-id>

agent project list
agent workspace list
agent workspace create

agent agent list
agent profile list
agent plugin list
agent plugin add <package-or-path>

agent tui
agent config get
agent config edit
agent doctor
```

`agent mobile serve --stdio`などの未実装コマンドは将来の薄いtransport adapterとし、業務ロジックは永続的な`agentd`へ委譲する。

## 16. セキュリティ

- WebSocket endpointはlocalhost bind + Tailscale Serveを基本とする
- Tailscale ACLでホスト単位・ユーザー単位のアクセスを制御する
- ブラウザ版はServe URLなどの非機密設定だけをWeb Storageへ保存する
- pairing tokenを追加する場合はデバイス単位で発行・失効できるようにする
- device token、秘密鍵、refresh tokenはnative Keychainまたはホスト側に保存し、Web bundleへ含めない
- Live Activityや通知にエージェントの出力全文を載せない
- `sendInput`、Approve、Rejectなどは対象Runの権限を確認する
- 重要な操作はaudit eventに記録する
- プラグインはホスト上で任意コードを実行できるため、インストール時に信頼確認を要求する
- 外部プラグインはJSONL/stdinプロセスに分離し、タイムアウト・クラッシュ・再起動を管理する
- 将来のサンドボックスはコンテナ、OS sandbox、専用ユーザーなどを検討する

## 17. 非機能要件

### 接続

- ブラウザ版はTailscale ServeのHTTPS/WSSで接続できる
- WebSocketは切断後に指数バックオフで自動再接続できる
- snapshotとevent sequenceから状態を復元できる
- agentd再起動後にtmuxペインを再発見できる
- オフライン中の未送信入力は無制限にキューしない

### 性能

- ターミナル出力を小さなイベント単位で無制限に送らない
- モバイルには表示中ペインの出力を優先して送る
- ペイン一覧や状態更新は軽量なJSONにする
- 端末出力と状態イベントを分離する

### テスト

- Domain/Applicationはtmuxなしでテストする
- tmux adapterはfixture用のtmux sessionで統合テストする
- AgentPluginはエージェントごとの出力fixtureで状態遷移をテストする
- WebSocketは再接続、重複、欠落、sequence resumeをテストする
- Live Activityは実機で入力待ち遷移と通知音を確認する

## 18. 実装フェーズ

### Phase 0: 契約と骨格

- Turborepo + pnpm monorepo構成
- Domain/Application/Protocol package
- Pane/Run/AgentStateの型
- WebSocket frame schema
- Plugin API v1の最小版
- fake tmux/agent fixture

### Phase 1: ホストMVP

- agentdの起動・停止・status
- Tailscale Serve経由のブラウザ接続設定
- tmux hook + client pollingによるviewport監視（Control Modeの管理経路は次段階）
- `node-pty` + `tmux attach-session -f active-pane`によるshellペインの表示・入力・resize
- viewport leaseによるスマホzoom、PC takeover、サイズ/layout復元
- xterm.jsのスマホviewport表示
- SQLite/Drizzle
- `agent pane list` CLIとPane Board
- tmux再起動復旧

### Phase 2: デスクトップTUI

- `agent tui`
- waitingペインの一覧
- ペイン選択後のattach/switch-client
- plugin/profile/workspaceの管理
- tmux status line連携

### Phase 3: モバイルPoC

- Web + xterm.js（必要に応じてCapacitorでiOS化）
- Serve URLを保存・切り替えできるブラウザ接続設定
- WSS接続
- 1ペイン表示
- キーボード、選択、コピー、スクロール
- ペイン一覧とoverlay

### Phase 4: 通知とiOS拡張

- Swift Capacitor plugin
- ActivityKit aggregate Live Activity
- WidgetKit snapshot
- Keychain
- APNs通知

### Phase 5: エージェント拡張

- shell plugin
- Codex plugin
- Claude plugin
- 宣言型Profile
- 外部JSONL plugin
- plugin doctorと権限表示

### Phase 6: Desktop UI（必要な場合のみ）

- Desktop Web UI
- イベント履歴、レイアウト、設定フォーム
- Tauri wrapper、tray、global shortcut

### Phase 7: 踏み台SSH経路（将来）

- `SshRouteProvider`のnative実装
- bastionからagentdホストへのlocal port forwarding
- Keychain参照、接続診断、切断時の確実なcleanup
- Serve経路と同じHTTP/WebSocket契約での統合テスト

## 19. 主なリスクと判断ポイント

| リスク | 判断方法 | 対応 |
|---|---|---|
| Tailscale ServeでWebSocketが安定しない | 実機から長時間接続・再接続を検証 | SSH port forwardまたは別proxy |
| WKWebViewで端末操作が不快 | xterm.jsのIME、選択、外部キーボードを先に検証 | SwiftUI/native terminal部分へ差し替え |
| エージェントの入力待ち検出が不安定 | 構造化イベントの有無を調査 | Plugin observer + fallback parser |
| Live Activity pluginが要件不足 | aggregate ActivityのPoCを作る | Swift extensionを自前実装 |
| 外部pluginの権限が大きい | install/doctorで権限表示 | 子プロセス、専用ユーザー、sandbox |
| tmuxとagentdの状態がずれる | 再起動・手動変更・pane移動をテスト | tmux option + recovery scan |
| 出力が多くモバイルが重い | 大量ログ・長時間接続を測定 | batch、rate limit、capture分離 |

## 20. 参考資料

- [tmux Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
- [Tailscale identity headers](https://tailscale.com/docs/concepts/tailscale-identity)
- [Capacitor plugin作成](https://capacitorjs.com/docs/plugins/creating-plugins)
- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)
- [React Native Turbo Modules with Swift](https://reactnative.dev/docs/the-new-architecture/turbo-modules-with-swift)
- [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/)
- [Capacitor Live Activities](https://github.com/Cap-go/capacitor-live-activities)
- [Capacitor WidgetKit](https://github.com/Cap-go/capacitor-widget-kit)
- [Mobilecode-open: Capacitor + Tailscale Serveの実装例](https://github.com/elkir0/Mobilecode-open)

## 21. 依存管理方針

- 依存を追加・更新する前に、npmの公開stableと各プロジェクトの公式リリースを確認する
- alpha、beta、rcなどのpre-releaseは、明示的な採用理由がない限り使わない
- 更新後は`pnpm deps:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`を実行する
- 最新版同士で互換性がない場合は、古い版を黙って固定せず、代替ライブラリまたは標準機能への置き換えを検討し、理由を設計書へ記録する
