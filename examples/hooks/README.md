# Worktree hook examples

このディレクトリには、`agent run ... --worktree` の setup / cleanup hook として使えるサンプルを置いています。

## 構成

- `generic/`: リポジトリに依存しない小さな部品
  - `copy-sqlite.sh`: 停止済みSQLiteの単一ファイルコピー
  - `allocate-ports.sh`: workspaceとnameのチェックサムからworktreeごとのポートを決定
  - `run-sqlite-migration.sh`: 設定したmigrationコマンドにworktreeのDBパスを渡す
  - `hook.sh`: setup / cleanup hook共通の補助関数
- `mobile-agent/`: 上記をmobile-agentの開発手順に合わせて組み合わせた例

`copy-sqlite.sh` はPOSIX shellと標準コマンドだけで動き、Node.jsやBunを必要としません。コピー元は書き込みを停止し、WALまたはrollback journalをcheckpoint済みにしてください。非空のjournalが残っている場合は、データを欠落させないためコピーを中止します。

setup hookは次の順に処理します。

1. 任意のベースSQLiteをworktreeの `.local/agentd.sqlite` にコピーする
2. `AGENT_WORKSPACE` と `AGENT_NAME` から `AGENTD_PORT` と `VITE_DEV_PORT` を決定し、worktreeの `.env` に保存する
3. `MOBILE_AGENT_INSTALL_DEPENDENCIES=1` の場合は `bun install --frozen-lockfile` を実行する
4. `MOBILE_AGENT_MIGRATION_COMMAND` が設定されている場合だけSQLite migrationを実行する

cleanup hookはポート解放を行いません。ポートは入力から機械的に決まるため、managed worktreeの削除時にregistryを掃除する必要がありません。DBと `.env` はworktree内に残しますが、managed worktreeの削除時に一緒に削除されます。

## mobile-agentで使う

hookはworktreeの中にコピーして使うものではなく、ホスト側に存在する実行可能ファイルとして登録します。まず実行権限を付けます。

```sh
chmod +x examples/hooks/generic/*.sh
chmod +x examples/hooks/mobile-agent/*.sh
```

CLIから直接使う場合:

```sh
agent run codex --worktree review \
  --setup-hook "$PWD/examples/hooks/mobile-agent/setup.sh" \
  --cleanup-hook "$PWD/examples/hooks/mobile-agent/cleanup.sh"
```

Web UIからworktreeを作る場合は、workspace登録時の `SETUP SCRIPT PATH` と `CLEANUP SCRIPT PATH` に、それぞれ次のようなホスト側の絶対パスを指定します。

```text
/path/to/mobile-agent/examples/hooks/mobile-agent/setup.sh
/path/to/mobile-agent/examples/hooks/mobile-agent/cleanup.sh
```

このリポジトリのデフォルトSQLiteをseedとして使う例:

```sh
MOBILE_AGENT_BASE_DB_FILE="$HOME/.local/state/mobile-agent/agentd.sqlite" \
MOBILE_AGENT_INSTALL_DEPENDENCIES=1 \
agent run codex --worktree review
```

ベースDBがない場合はコピーをスキップし、agentdがworktree側のDBを新規作成します。コピー元を必須にする場合は `MOBILE_AGENT_REQUIRE_BASE_DB=1` を追加してください。既存のworktree DBを明示的に上書きする場合だけ `MOBILE_AGENT_DB_COPY_FORCE=1` を使います。

ポートは `AGENT_WORKSPACE` と `AGENT_NAME` の組み合わせから決まります。同じworkspaceで同じnameはCLI上でも重複できないため、通常のworktree同士は異なるslotになります。nameを省略して自動生成名を使う場合は、作成し直すと別のポートになる可能性があります。

現在のmobile-agentは起動時の `ensureSchema` でDBスキーマを準備しており、リポジトリに適用済みmigrationの実行コマンドはまだ固定していません。migrationを導入した環境では、次のようにコマンドを指定できます。

```sh
MOBILE_AGENT_MIGRATION_COMMAND='bun run db:migrate' \
agent run codex --worktree review
```

`MOBILE_AGENT_MIGRATION_COMMAND` はローカルの信頼できる設定値として `sh -c` で実行され、`AGENTD_DB_FILE` と `AGENT_SQLITE_FILE` にworktree側のDBパスが設定されます。

## 主な設定値

| 設定 | 既定値 | 用途 |
| --- | --- | --- |
| `MOBILE_AGENT_BASE_DB_FILE` | `AGENTD_DB_FILE` または `~/.local/state/mobile-agent/agentd.sqlite` | コピー元SQLite |
| `MOBILE_AGENT_DB_PATH` | `.local/agentd.sqlite` | worktree内のSQLiteパス |
| `MOBILE_AGENT_ENV_FILE` | `.env` | ポートとDBパスを書き込むenvファイル |
| `MOBILE_AGENT_PORT_STRIDE` | `3` | ハッシュslotごとのポート増分 |
| `MOBILE_AGENT_PORT_SLOT_COUNT` | `20000` | ハッシュslotの数 |
| `MOBILE_AGENT_INSTALL_DEPENDENCIES` | `0` | `1`でlocked dependenciesをインストール |
| `MOBILE_AGENT_MIGRATION_COMMAND` | 未設定 | 設定時だけmigrationを実行 |

allocatorはポートregistryを作らず、外部プロセスへのbind確認も行いません。外部プロセスによる使用や、ハッシュslotの衝突は完全には防げないため、`bun run dev` のstrict portエラーが出た場合は `.env` の `AGENTD_PORT` / `VITE_DEV_PORT` を手動で変更してください。既存のポート値はsetupを再実行しても上書きされません。

## 他のリポジトリで部品を使う

SQLiteのコピー:

```sh
examples/hooks/generic/copy-sqlite.sh \
  --source /path/to/base.sqlite \
  --target "$AGENT_WORKTREE/.local/app.sqlite"
```

ポート割当とenv更新:

```sh
examples/hooks/generic/allocate-ports.sh allocate \
  --key "$AGENT_WORKSPACE:$AGENT_NAME" \
  --env-path "$AGENT_WORKTREE/.env" \
  --stride 3 \
  --slot-count 20000 \
  --port API_PORT=4317 \
  --port WEB_PORT=5227
```

複数のサービスを割り当てる場合、`--port NAME=BASE` のbase値は、同じ `--stride` に対して異なる余りのlaneを使ってください。例えば `4317` と `5227` は `--stride 3` では異なるlaneです。部品を組み合わせるときは、setupを冪等にし、秘密情報をリポジトリ内のhookや生成ログに書き出さず、hookのパスは対象ホストの設定として管理します。
