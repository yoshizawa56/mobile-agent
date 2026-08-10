# tmuxペイン描画の継続調査

最終更新: 2026-08-09

## 現時点の実装方針

MVPは、同じtmux paneをPCとモバイルで共有し、モバイル接続中だけviewport leaseを取得する方式で開始する。接続時に対象paneを選択し、モバイルclientを`active-pane`付きでattachしてzoomを有効にする。

```text
xterm.js
  ⇅ WebSocket（制御JSON + 端末バイト列）
agentd
  ⇅ node-pty
tmux attach-session -t <target>
  ⇅
tmux window / pane内のTUI
```

端末のエスケープシーケンスの解釈、カーソル、スクロールバック、コピー選択、マウス入力は、Web側のxterm.jsに任せる。agentdは端末バイト列を意味解釈せず、PTYのサイズ変更と入出力の中継に加えて、tmuxのviewport leaseだけを担当する。

接続時にはxterm.jsの現在の`cols/rows`をPTYへ渡す。つまり、TUIはスマホ向けの実際の端末サイズで描画される。初期実装では、同じtmuxセッションに接続しているPC側にもこのサイズ変更が見える可能性がある。

## Control Modeを表示経路にしない理由

tmux Control Modeは、ペイン一覧、ライフサイクル、入力、リサイズ、メタデータ監視の管理経路として有用である。一方、モバイルの対話端末を成立させるには、PTYを持つ端末クライアントと端末エミュレーターの組み合わせが自然である。

そのため、端末データ経路と管理経路を分ける。

- 端末データ経路: `node-pty`で`tmux attach-session`を実行し、raw bytesをWebSocketへ中継
- 管理経路: 将来のagentd内部でtmux Control Modeを使い、ペインの発見、user option、Run状態、イベントを扱う
- Web側: xterm.jsでraw bytesを解釈・描画する

## 個別paneをPCと干渉せずに表示する候補

### A. tmuxのzoomを使う（MVP）

`resize-pane -Z`相当のzoomと、対象paneを選択した通常のtmux clientを使う。実装が単純で、TUIの実際の端末サイズも一致する。`attach-session -f active-pane`により、モバイルclientのactive paneはPC clientから分離する。一方、zoomとwindowサイズはwindow単位なので、viewport lease中はPC側も狭くなる。

lease取得時にはlayout、zoom、active pane、window-size、window幅・高さを保存する。既存のPC clientには一時的に`active-pane` flagを付け、モバイルのpane選択でPC clientのカーソル位置が動かないようにする。PCのclient-active/client-resized/client-focus-inを受けたらdesktop ownerへ遷移し、zoom解除とPCサイズ復元を行う。切断時は、PC takeoverがなければsnapshotを完全復元し、takeover後はPCの状態を優先する。

### B. 専用tmux clientを作る

agentdがモバイル専用のtmux clientを別に持つ点はMVPでも採用する。ただし、これは別のagent Runを起動するツイン方式ではなく、同じpaneへ接続するclientである。`active-pane`でpane選択を分離し、window-levelのzoom/サイズはleaseで管理する。

### C. Control Mode + xterm headlessでpaneごとに再描画する

tmuxからraw outputを受け取り、paneごとに独自の端末エミュレーター状態を持つ。PCのレイアウトとは独立できるが、tmux Control Modeから来る出力はそのclientのサイズに依存する。スマホ幅の別サイズでTUIを正しく再構築するには、agentを別PTYで実行するか、TUI側がマルチビューポートを理解する必要がある。

### D. エージェントごとにモバイル専用Runを起動する

完全に独立したサイズで対話できるが、PCとモバイルで同じプロセスを共有できない。履歴、作業状態、同時入力の競合を別途定義する必要があり、現段階では採用しない。

## 次に検証するケース

- 同じwindowへPC clientとモバイルclientを接続し、異なる幅で`resize`した場合のTUI表示（実装済み）
- `active-pane`付きmobile clientがPCのactive paneを変更しないこと（実装済み）
- 対象paneのzoom中にPC clientが入力・resizeした場合のdesktop takeover（実装済み）
- 既存PC clientへの`active-pane`一時付与と元flag復元（実装済み）
- `window-size latest|largest|smallest|manual`とlease復元の組み合わせ
- tmux Control Modeの`%output`と`capture-pane`を、xterm.js / `@xterm/headless`へ供給した場合の初期同期
- copy mode、マウス入力、alternate screen、IME、Unicode幅、画像プロトコル
- paneごとに専用clientを持った場合のclient数、CPU、再接続、終了処理

## 保留している設計

MVPではviewport leaseを導入し、ownerを明示する。ツイン方式は、同時操作やagentごとの独立サイズが必要になった場合に再検討する。

```text
viewportOwner: none | desktop | mobile
mode: interactive | observer
```

owner以外は表示・入力を許可しても、サイズ変更やフォーカス変更を行わないobserver modeにできるようにする。
