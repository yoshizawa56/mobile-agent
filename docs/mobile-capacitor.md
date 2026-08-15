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

## Release CI and App Store Connect

The `preflight` and `release` workflows are separate. Shared repository checks
and iOS build/upload processing live in local composite actions under
`.github/actions/`, while only the final workflow contains standalone agent
builds and GitHub Release publishing.

- `preflight/v0.1.0` or `preflight/v0.1.0-beta.1` runs repository checks and
  uploads a signed `Release` build to App Store Connect for TestFlight
  validation. It does not build the standalone agent release or create a
  GitHub Release.
- `v0.1.0` or `v0.1.0-beta.1` requires the matching preflight tag to point to
  the same commit and a successful `preflight` workflow run for that exact tag
  and commit. It then rebuilds that commit, uploads the resulting `.ipa`, and
  creates the GitHub Release. The workflow does not submit the build to App
  Review or publish it to the public App Store.

Before pushing a release tag, create a GitHub Environment named
`app-store-connect`. Add the following environment variables and secrets to
that environment. Required reviewers are not necessary if protected tag
creation is the release approval; configure the environment's deployment tag
policy to allow only `preflight/*` and `v*`.

Protect the `preflight/*` and `v*` tag namespaces with repository rules that
restrict tag creation, updates, and deletion to the release maintainers. The
rules should cover tag refs, not branch refs. The final workflow also checks
the completed result of the exact preflight workflow run, so pushing the final
tag too early fails closed; rerun that final workflow after preflight finishes.

On the Apple side, create the App Store Connect app record for bundle ID
`com.mobileagent.app`, and prepare an Apple Distribution certificate, an App
Store provisioning profile for that bundle ID, and an App Store Connect API key
with upload permission.

Variables:

- `IOS_RELEASE_HTTP_URL`: the production HTTPS URL served by agentd;
- `IOS_RELEASE_WS_URL`: the matching `wss://` terminal endpoint.

Secrets:

- `IOS_ASC_API_KEY_ID`: App Store Connect API key ID;
- `IOS_ASC_ISSUER_ID`: App Store Connect issuer ID;
- `IOS_ASC_API_PRIVATE_KEY`: the complete contents of the downloaded `AuthKey_<key-id>.p8` file;
- `IOS_DIST_CERTIFICATE_BASE64`: base64-encoded Apple Distribution `.p12` certificate;
- `IOS_DIST_CERTIFICATE_PASSWORD`: password for that `.p12` file;
- `IOS_APP_STORE_PROFILE_BASE64`: base64-encoded App Store provisioning profile for `com.mobileagent.app`.

For example, create the two base64 values locally without committing the
original signing files:

```sh
base64 -i ios-distribution.p12
base64 -i MobileAgentAppStore.mobileprovision
```

The profile's App ID must be exactly `com.mobileagent.app`, and the
distribution certificate and profile must belong to the same Apple Developer
Team. The workflow derives the marketing version from the tag and generates a
unique execution-time App Store build number. iOS release jobs are serialized
so retries and preflight/final tags cannot race while allocating build numbers.

After the environment is configured, push a preflight tag at the candidate
commit:

```sh
CANDIDATE_SHA="$(git rev-parse HEAD)"
git tag "preflight/v0.1.0" "$CANDIDATE_SHA"
git push origin "preflight/v0.1.0"
```

After the build has been processed and validated in TestFlight, create the
final tag on the same commit:

```sh
git tag "v0.1.0" "$CANDIDATE_SHA"
git push origin "v0.1.0"
```

The final workflow checks that `preflight/v0.1.0` and `v0.1.0` resolve to the
same commit and that the preflight workflow completed successfully before
building. Apple still processes the uploaded build asynchronously; uploading
the build does not submit it to App Review or make it available to App Store
customers.

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
