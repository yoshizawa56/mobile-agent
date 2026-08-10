# Mobile Agent

tmux上のエージェントやシェルを、iPhone向けに1ペイン単位で扱うためのモノレポです。

> **Pre-alpha:** 公開開発の初期段階です。設定・API・データ形式はまだ変更される可能性があります。現在のセキュリティ上の制約は [SECURITY.md](SECURITY.md) を確認してください。

[![CI](https://github.com/yoshizawa56/mobile-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yoshizawa56/mobile-agent/actions/workflows/ci.yml)

## OSS project files

- [LICENSE](LICENSE): MIT License
- [CONTRIBUTING.md](CONTRIBUTING.md): 開発環境、テスト、PRのルール
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): コミュニティ行動規範
- [SECURITY.md](SECURITY.md): 脆弱性報告と現在のセキュリティ境界

公開前の追跡対象・未追跡ファイルを検査するには、次を実行します。

```sh
pnpm audit:public
```

## 開発中の最小縦切り

- `apps/agentd`: tmuxの対象paneへ`active-pane`付きでattachし、viewport leaseを管理しながら端末バイト列をWebSocketで中継
- `apps/agentd`: HonoでHTTP APIを提供する常駐control-plane daemon
- `apps/agent-cli`: SQLiteでagent lifecycleを管理する`agent` CLI
- `apps/web`: xterm.jsで1ペインを描画し、端末サイズをagentdへ通知
- `packages/agentd-client`: Hono RPC、Zod検証、agentd WebSocketをまとめたTypeScript client
- `packages/domain`: Pane/Runの状態とagent待機状態のドメイン規則
- `packages/application`: CLI/WebSocketが共有するUse Case/Port
- `packages/persistence`: Drizzle + SQLiteのPane/Run/Audit/Workspace/Project/AgentSession永続化
- `packages/agents`: AgentPlugin APIとshell plugin
- `packages/protocol`: WebSocketとPane Board DTOをZodで定義

```sh
mise install
pnpm install --frozen-lockfile
pnpm dev
```

`mise`はNode.js、pnpm、tmuxのツールチェーンを固定し、pnpmはJavaScript依存関係を`pnpm-lock.yaml`に固定します。

依存関係を追加・更新するときは、npmのstable公開版と公式リリースを確認してから反映します。確認には`pnpm deps:check`を使います。alpha/beta/rcは原則採用しません。

agentdは`http://127.0.0.1:4317`でHTTP API、`ws://127.0.0.1:4317/terminal`で端末WebSocketを提供します。セッション一覧・ペイン一覧・セッション作成・ペイン作成はHTTP API、端末入出力とresizeはWebSocketを使います。agentdはtmux・agent plugin・SQLiteをホスト上で管理する常駐control-plane daemonです。

HTTP APIは`createAgentdApp(deps)`でDIされるHono appから作られ、`ReturnType<typeof createAgentdApp>`を`AgentdApp`としてTypeScript clientへ共有します。Tailscale ServeとSSH port forwardingは同じagentdへ到達するための経路であり、Web側のAPI clientは経路を意識しません。

ブラウザ版はTailscale Serve URLだけを接続設定として保存できます。秘密鍵やパスワードはブラウザへ保存しません。Storybookはモックデータで動き、通常のVite開発サーバーはagentdへ接続します。

```sh
pnpm --filter @mobile-agent/web dev
# agentdを使わず見た目だけ確認するとき
VITE_AGENTD_MOCK_MODE=true pnpm --filter @mobile-agent/web dev
```

Serve接続を使う場合はWeb画面の`settings`から、ホスト上で公開したServe URLを登録します。

```sh
agentd  # 127.0.0.1:4317で常駐
tailscale serve --bg 4317
```

ブラウザ版の標準経路はHTTPS/WSSのTailscale Serveです。SSH踏み台経路はnative版の将来adapterとして設計だけを確保しており、現在のWeb bundleにはSSHや秘密鍵管理を含めません。

Viteの開発proxyを別のagentdへ向ける場合は、`VITE_AGENTD_PROXY_TARGET`を指定します。SSH port forwardingをnative bridgeで開始した後は、同じ`AgentdConnection`へlocalhostのHTTP/WebSocket URLを渡します。

Storybookでは画面を単体で確認できます。Storybookは`0.0.0.0:6006`で起動し、Tailscale Serveの設定後は`https://<このMacのtailnet hostname>:8448/`で閲覧できます。

```sh
pnpm --filter @mobile-agent/web storybook
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8448 6006
```

Viteの実アプリをtailnetから確認する場合は、ViteのHostチェックにtailnet hostnameを追加して別ポートへ公開します。既存のStorybook公開設定は残ります。

```sh
VITE_AGENTD_PROXY_TARGET=http://127.0.0.1:4318 \
VITE_ALLOWED_HOSTS=<tailnet-hostname> \
pnpm --filter @mobile-agent/web dev --host 127.0.0.1 --port 5227
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8449 5227
```

## agent CLI

dotfiles側の`bin/agent`が持っていた実行ライフサイクルは、SQLiteを正規の状態源としてTypeScriptへ移植しています。旧`.state`ファイルは読みません。

```sh
agent run codex --worktree review
agent run claude --no-worktree -n quick-fix
agent resume review
agent list --json
agent list --global
agent cleanup review --force
agent project list
agent doctor --verbose
```

`--worktree`では`agent/<name>`ブランチを作成し、project定義の`agent/setup`・`agent/cleanup` hookを実行します。終了時に変更があるworktreeは確認後に削除し、Codexのmanaged Remote Controlを利用している場合はthreadの名前付け・archiveもCLIが管理します。

状態DBの既定値は`~/.local/state/mobile-agent/agentd.sqlite`です。`AGENTD_DB_FILE`、`AGENT_PROJECTS_ROOT`、`AGENT_WORKTREE_ROOT`、`AGENT_HOOK_OUTPUT_DIR`で変更できます。ライフサイクル状態はSQLiteだけに保存し、旧`.state`ファイルは読みません。hookのstdoutログはDB状態とは分離した一時的な実行成果物として保存し、セッションのcleanup成功時に削除します。

tailnet内へ公開するときは、agentdをlocalhostで起動したままTailscale Serve/ACLで4317番ポートを公開します。現MVPの認証境界はTailscale Serve/ACLです。identity header検証とdeviceごとのpairing tokenは次のセキュリティ実装として追加します。

このMVPではスマホ接続中だけ対象windowをスマホサイズへ変更し、対象paneをzoom表示します。PC操作を検知するとdesktop ownerへ戻り、PCサイズとlayoutを復元します。ツイン方式による完全な独立pane描画は将来の拡張です。

Pane Boardはagentdの`/api/panes`をTanStack Queryで取得し、ペイン選択後に1ペインのcontrol roomを開きます。
control roomの端末ヘッダーにある`＋`からも新しいpaneを作成でき、`new window`、既存paneの`right`分割、`bottom`分割と分割元paneを選べます。セッション概要からはshell、Codex、Claudeの新しいpaneを作成でき、worktreeを選ぶ場合はホスト側の`agent run` commandへ委譲します。
