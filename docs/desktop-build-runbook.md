# Desktop Build Runbook

Operational notes for building, signing, and debugging the Electron desktop artifact (`apps/desktop` packaged via `scripts/build-desktop-artifact.ts`). **Read this before touching the build pipeline or debugging a desktop install/launch failure.** It encodes lessons paid for in real wall-clock time.

## Diagnostic-first protocol

When the desktop app misbehaves, **diagnose before rebuilding**. A rebuild on Apple Silicon takes 8–15 minutes (codesign-bound). Most of the time the bug is not in the binary — it's in the bundled web client or a logic regression on the current branch.

### "App launches but window is blank / shows just the T3 icon centered on a dark background"

This is **the splash screen** (`<div id="boot-shell">` in `apps/server/dist/client/index.html`). It only ever disappears when React mounts and replaces the `#root` content. If it stays, **React threw at module load**.

**First action:** attach Chrome DevTools to the running renderer.

```fish
# Kill any existing instance, then launch with the remote debugging port.
pkill -9 -f "T3 Code (Alpha)"; sleep 2
"/Applications/T3 Code (Alpha).app/Contents/MacOS/T3 Code (Alpha)" --remote-debugging-port=9222 &

# Discover the page WebSocket URL.
curl -s http://127.0.0.1:9222/json | jq -r '.[0].webSocketDebuggerUrl'
```

Connect a DevTools session and capture `Runtime.exceptionThrown` events **from before navigation** — exceptions thrown at module-evaluation time are easy to miss if you enable `Runtime` after the page has finished loading. Use `Page.reload {ignoreCache: true}` after enabling `Runtime`/`Page` if you need to re-trigger the failure.

The bundled JS lives at `<asar>/apps/server/dist/client/assets/`. To grep the deployed bundle:

```fish
bun x asar extract-file \
  "/Applications/T3 Code (Alpha).app/Contents/Resources/app.asar" \
  apps/server/dist/client/assets/<chunk>.js \
  /tmp/<chunk>.js
```

### "App was running but the install failed: 'CodeResources couldn't be copied to \_CodeSignature'"

Finder/Installer is rejecting a malformed `_CodeSignature` directory inside the `.app` bundle. Verify before reaching for workarounds:

```fish
codesign -dv "/Volumes/<dmg-volume>/T3 Code (Alpha).app"
codesign --verify --deep --strict --verbose=2 "/Volumes/<dmg-volume>/T3 Code (Alpha).app"
```

If `codesign -dv` reports `Input/output error` or the verify exits non-zero, the bundle was packaged with a partial signature (a `_CodeSignature/CodeResources` exists but isn't valid). The build pipeline now defaults to a real signing identity when `--signed=false`, so a fresh build should not produce this. If it does, treat it as a packaging regression in `scripts/build-desktop-artifact.ts`, **not** as something to paper over with `xattr -cr` + manual `codesign --sign -`.

For the install itself, prefer `cp -R` over Finder drag-and-drop when scripting. Finder validates the signature on copy; `cp -R` does not, which is sometimes what you want for diagnosis.

## Build script invariants — things that are easy to miss

### `apps/server/scripts/cli.ts` always applies development icons

The `build` subcommand (run by `bun run build:desktop`) unconditionally calls `applyDevelopmentIconOverrides`, which copies dev-blueprint icons over `apps/server/dist/client/{favicon*.{ico,png},apple-touch-icon.png}`. The `boot-shell` splash renders `apple-touch-icon.png` directly, so any artifact built without a counter-override will show the dev-branded icon during startup.

Two paths swap dev icons back to production icons:

- `npm publish` flow (`apps/server/scripts/cli.ts:applyPublishIconOverrides`) — backup-and-restore around the publish step.
- Desktop artifact flow (`scripts/build-desktop-artifact.ts`) — applies `PUBLISH_ICON_OVERRIDES` in-place against the staged `apps/server/dist/client/` directory **after** copying `serverDist` into the stage.

If you change either flow, change them together. A dev-branded icon in a "production" DMG is a build-pipeline regression, not a cosmetic bug — it's the most visible signal that the pipeline took a wrong branch.

### `mac.identity` fuzzy-matches keychain certs by substring

`electron-builder`'s `mac.identity` field is **not** a literal codesign argument. When set, it does a substring match against `security find-identity` output. Setting `identity: "-"` to mean "ad-hoc" will instead match any keychain certificate whose name contains a hyphen (e.g. `imp-dev`, `Developer ID Application: …`). The build will then sign with that cert — which is sometimes desirable but rarely what you intended.

For genuine ad-hoc signing, use `identity: null` and post-process with `codesign --force --deep --sign - <app>` after electron-builder finishes (note: this requires re-packaging the DMG). For a real-cert build on a developer machine, let auto-discovery do its job and don't set `CSC_IDENTITY_AUTO_DISCOVERY=false`.

### `--timestamp` is per-file TSA round-trip — disable for local builds

`codesign --timestamp` contacts Apple's RFC 3161 TSA server. An Electron framework has hundreds of locale files, each requiring its own TSA call; a timestamped local build takes 10+ minutes on a healthy network and longer on flaky ones. Cryptographic timestamps are only required for **notarization**, which is a separate step.

The build script disables timestamps when `--signed=false` (`mac.timestamp = null` in `createBuildConfig`). If you find yourself waiting more than ~3 minutes during the codesign phase of an unsigned local build, something is wrong — check that this default is still in place.

### `--skip-build` reuses existing dist artifacts

`scripts/build-desktop-artifact.ts --skip-build` does not run `bun run build:desktop`; it stages whatever's currently in `apps/desktop/dist-electron`, `apps/server/dist`, and `dist/ssh-binaries`. Useful for iterating on the packaging step without re-bundling the web client (which dominates the timing). Make sure your dist artifacts are fresh when you use it — modification times are not validated, so a stale `apps/server/dist/client` will silently produce a stale DMG.

## Renderer-side rules that the desktop bundle depends on

### Do not call `readLocalApi()` at module load time

`readLocalApi()` (in `apps/web/src/localApi.ts`) ultimately reaches into `getPrimaryEnvironmentConnection()`, which throws `Unable to resolve the primary environment.` until the descriptor at `/.well-known/t3/environment` has been fetched. That fetch is async and fires **after** the JS bundle has finished evaluating top-level module code.

Any module that runs `readLocalApi()` from a top-level statement will throw during bundle evaluation, which prevents React from mounting and leaves the boot-shell splash on screen forever — the exact failure mode that motivates this section.

For desktop-only persistence (theme prefs, markdown prefs, saved environments, etc.), call `window.desktopBridge.<method>()` directly. The preload-exposed bridge is available synchronously at module load. `readLocalApi()` is only safe inside callbacks/effects/handlers that fire after bootstrap.

The current canonical example is `apps/web/src/theme/store.ts` (`hydrateFromDesktop` / `persistToDesktop`) — copy that pattern when adding new persistent client state that needs to hydrate before the rpc client is up.

## Verifying a fix without a full rebuild

When the suspected bug is in the bundled web client, you do not need to re-run `electron-builder`:

1. Edit the source under `apps/web/src/`.
2. `bun run --cwd apps/web build` → produces `apps/web/dist`.
3. `bun run build:desktop` → bundles the web app into `apps/server/dist/client` (turbo will skip cached steps; the server bundle and icon overrides will re-run).
4. Restart the _installed_ app — Electron loads the asar from `/Applications/T3 Code (Alpha).app/Contents/Resources/app.asar`, which is **not** updated by the above steps. So this shortcut only verifies that the source fix is correct in isolation; it does not verify the packaged artifact.
5. To verify the packaged artifact, run `bun run scripts/build-desktop-artifact.ts --platform mac --arch arm64 --skip-build` and reinstall.

For pure renderer-side diagnosis (no Electron-specific code paths), point a regular Chrome at the running app's backend URL — it will be logged in `~/.t3/userdata/logs/desktop-main.log` as `bootstrap resolved backend endpoint baseUrl=http://127.0.0.1:<port>`. Browser visits get a pairing prompt at `/pair`; the app's bundled renderer bypasses pairing via the desktop bridge. Useful for splitting "is the bundle broken?" from "is the desktop integration broken?".

## Logs and where to look

| Log                  | Path                                               | What's in it                                               |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Desktop main process | `~/.t3/userdata/logs/desktop-main.log`             | Bootstrap stages, backend port selection, window lifecycle |
| Server child         | `~/.t3/userdata/logs/server-child.log`             | HTTP/WS server stdout, listen messages, runtime warnings   |
| Server traces        | `~/.t3/userdata/logs/server.trace.ndjson{,.1..10}` | Effect tracing, structured events                          |

`bootstrap backend ready` followed by `bootstrap main window created` indicates a healthy startup from the main-process side — but says nothing about whether the renderer mounted. If you see those lines and the app is still blank, the bug is in the renderer; jump to the diagnostic-first protocol above.

## Things that are NOT the bug (anti-patterns to avoid)

- "The DMG window in Finder shows only the T3 icon, no Applications shortcut." — That's a `.DS_Store` window-layout artifact in the DMG, not a build failure. Use `cp -R` from a script or resize the Finder window.
- "Multiple T3 instances spawn when I `open` the app from the terminal." — `open` does not single-instance-check by default. Each invocation creates a new window. Always `pkill -9 -f "T3 Code (Alpha)"` before relaunching during a debugging session.
- "Backend chose port 3774 instead of 3773." — Sequential port scan in `apps/desktop/src/main.ts:resolveDesktopBackendPort`. 3773 was held by another process (often a leftover dev server). Not a bug.
- "Port 3773 in a browser shows a pairing prompt." — Expected. Browser visits go through pair-gating; the desktop renderer bypasses it via desktop bridge credentials.

## Hard-won rules for future-you

1. **Reach for the renderer's exception log before reaching for `electron-builder`.** A 30-second CDP attach beats a 12-minute rebuild.
2. **The dev icon is a signal, not noise.** If a "production" build is rendering dev-blueprint assets, the build pipeline took a wrong branch. Track it down before shipping.
3. **`identity: "-"` is a footgun.** Don't use it. Either let auto-discovery work, or set `identity: null` and ad-hoc sign post-build.
4. **`--timestamp` for local builds is a 10× slowdown for zero local benefit.** Keep it disabled in the unsigned path.
5. **Don't touch the rpc client at module load.** Use `window.desktopBridge` for anything that has to fire before bootstrap completes.
