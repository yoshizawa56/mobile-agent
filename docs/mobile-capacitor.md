# Capacitor mobile shell

The iOS shell lives under `apps/web/ios` and packages the existing Vite build.
The Web UI remains the source of truth for screens, routing, HTTP, WebSocket,
and xterm.js. Capacitor is the native lifecycle boundary around that bundle.

## Local workflow

From the repository root:

```sh
bun install --frozen-lockfile
bun run --filter @mobile-agent/web cap:sync
bun run --filter @mobile-agent/web cap:open
```

`cap:sync` builds `apps/web/dist` and copies it into the iOS project. Run the
Debug app from Xcode or `cap:run`. The `Local` scheme reads the fixed Web URL
from the ignored `apps/web/ios/local.xcconfig` at native build time. Set it up
once from the committed example:

```sh
cp apps/web/ios/local.xcconfig.example apps/web/ios/local.xcconfig
# Edit local.xcconfig and set MOBILE_AGENT_WEB_SCHEME, MOBILE_AGENT_WEB_HOST,
# and MOBILE_AGENT_WEB_PORT to this machine's Serve URL.
```

The URL is assembled from those build settings and embedded in the native
build's `Info.plist`; it is not entered or
stored on the phone. Changing this machine-specific URL requires a native
rebuild, but does not require a Capacitor sync.

For the normal local workflow, keep the external Tailscale Serve URL fixed and
change only its local Vite target when switching worktrees:

```sh
bun run dev
mise run dev-serve
# When another worktree uses port 5228:
tailscale serve --bg --https=8449 5228
```

`bun run --filter @mobile-agent/web cap:run` remains available after the
native project has been prepared. The committed Capacitor config has no
machine-specific URL, so staging and release builds continue to use bundled
web assets.

Bundled builds must receive the agentd endpoint before `vite build`. Copy the
Vite environment example and set the fixed Tailscale Serve URL:

```sh
cp apps/web/.env.example apps/web/.env.local
# Edit apps/web/.env.local and set VITE_AGENTD_HTTP_URL and
# VITE_AGENTD_WS_URL for the agentd-only Serve endpoint.
bun run --filter @mobile-agent/web cap:sync
```

`VITE_AGENTD_HTTP_URL` and `VITE_AGENTD_WS_URL` are compiled into the React
bundle. Changing them requires rebuilding and syncing the web assets; iOS
build settings do not change these values.

The iOS project has three shared schemes:

- `Local` (`Debug`): embeds the `MOBILE_AGENT_WEB_*` settings from
  `local.xcconfig` and loads the fixed Serve endpoint;
- `Staging` (`Staging`): uses bundled assets and bundle ID
  `com.mobileagent.app.staging`;
- `Release` (`Release`): uses bundled assets and bundle ID
  `com.mobileagent.app`.

Switching the worktree behind the fixed Serve endpoint does not require a
native rebuild. Only changing the `MOBILE_AGENT_WEB_*` settings themselves
requires rebuilding the native binary.

The app connects to agentd through the full Tailscale Serve URL compiled into
the bundle. No Tailscale credentials, SSH private keys, or host-side ports are
placed in the WebView.

## Bridge boundary

`apps/web/src/platform/mobile-bridge.ts` exposes the small native contract used
by the Web UI:

- `@capacitor/app` supplies foreground/background transitions on native builds;
- returning to the foreground asks the terminal view to recreate its WebSocket;
- browser builds use `visibilitychange` as the equivalent lifecycle signal;
- route provider, Keychain, notifications, and Live Activities are explicit
  disabled capabilities for the current Serve-based MVP.

An eventual SSH route should be added as a native-only `AgentdRouteProvider`
that returns an `AgentdConnection` with a `close()` callback. It must keep key
material in native Keychain storage and must not add SSH code or secrets to the
Web bundle. Notifications and ActivityKit should likewise be added behind
separate native capabilities once agentd emits the required state transitions.

## Platform requirements

The generated project targets iOS 15 and uses Capacitor 8. Xcode and the iOS
SDK must be installed before opening the project. See the [Capacitor iOS
documentation](https://capacitorjs.com/docs/ios) for the supported toolchain.
