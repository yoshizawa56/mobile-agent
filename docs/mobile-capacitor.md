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

Bundled builds do not receive an agentd endpoint at build time. The first-run
screen asks the user to scan the `agent pair` QR code, then stores the agentd
connection profile in Web Storage and the browser device key in IndexedDB.
The same flow is used by browser and Capacitor builds, so `cap:sync` needs no
agentd-related `.env.local` file.

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

The app connects to agentd through the full endpoint imported from the saved
pairing profile. No Tailscale credentials, SSH private keys, or host-side
ports are placed in the WebView.

## Release CI and App Store Connect

The `TestFlight` workflow is a manual `workflow_dispatch` workflow. Select the
branch in GitHub Actions and run it against the current `GITHUB_SHA`; the run
summary records both the ref and exact commit. It has no version input and does
not create a Git tag.

The native app marketing version is read from `apps/web/package.json`. Every
upload receives a unique timestamp-based App Store build number, so repeated
TestFlight builds of the same package version can be distinguished by build
number, upload time, and the recorded commit SHA. To start a new App Store
version, update the package version in a normal source change.

The `v0.1.0` or `v0.1.0-beta.1` tag starts the final release workflow directly.
It runs repository checks, builds the standalone agents, uploads the iOS app,
and creates the GitHub Release. It does not submit the build to App Review or
publish it to the public App Store.

Before running TestFlight or pushing a release tag, add the following values to
the repository-level Actions secrets at `Settings > Secrets and variables >
Actions > Repository secrets`. A GitHub Environment is not required for these
workflows.

On the Apple side, create the App Store Connect app record for bundle ID
`com.mobileagent.app`, and prepare an Apple Distribution certificate, an App
Store provisioning profile for that bundle ID, and an App Store Connect API key
with upload permission.

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
Team. The workflow derives the marketing version from
`apps/web/package.json` for manual TestFlight runs and from the `v*` tag for
final releases. It generates a unique execution-time App Store build number.
iOS upload jobs are serialized so concurrent manual runs cannot race while
allocating build numbers.

After the repository secrets are configured, open the `TestFlight` workflow in
GitHub Actions, select the branch containing the candidate commit, and choose
`Run workflow`. The run summary shows the exact commit uploaded to App Store
Connect. The equivalent CLI command is:

```sh
gh workflow run testflight.yml --ref main
```

After the build has been processed and validated in TestFlight, create the
final tag when you are ready to publish the corresponding source release:

```sh
CANDIDATE_SHA="<the SHA shown in the TestFlight run summary>"
git tag "v0.1.0" "$CANDIDATE_SHA"
git push origin "v0.1.0"
```

Apple still processes the uploaded build asynchronously; uploading the build
does not submit it to App Review or make it available to App Store customers.

## Bridge boundary

`apps/web/src/platform/mobile-bridge.ts` exposes the small native contract used
by the Web UI:

- `@capacitor/app` supplies foreground/background transitions on native builds;
- the Settings screen reads the native bundle's marketing version and build
  number through `App.getInfo()`; browser builds fall back to the Web package
  version;
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
