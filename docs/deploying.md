# Deploying T3 Code to another machine

How to get this fork's builds onto a machine you use daily (for example a
work laptop), without running from a source checkout.

## TL;DR (macOS work laptop)

1. Open the fork's [GitHub Releases](https://github.com/jamesainslie/t3code/releases).
2. Download the DMG for your architecture from the newest release in your
   chosen channel (Apple Silicon: `*-arm64.dmg`).
3. Drag the app to Applications and launch it. Builds are Developer ID signed
   and notarized, so Gatekeeper accepts them without workarounds.
4. Done. The app checks GitHub Releases for updates in the background; when
   one is available a rocket button appears. Click once to download, again to
   restart into the new version. No token is needed (the repo is public).

## Choosing a channel

| Channel | Cadence                                     | Tag shape                    | Tracks                   |
| ------- | ------------------------------------------- | ---------------------------- | ------------------------ |
| Stable  | when a `vX.Y.Z` tag is pushed               | `v0.0.34`                    | `latest*.yml` manifests  |
| Nightly | every 3 hours from `main` (when it changed) | `v0.0.35-nightly.YYYYMMDD.N` | `nightly*.yml` manifests |

The installed app follows the channel it was installed from. If you want new
fork features (like the chat mermaid hardening) on your laptop quickly,
install a nightly build once; it will keep tracking nightlies. If you prefer
deliberate upgrades, install a stable build and cut a stable tag whenever you
want the laptop to move:

```bash
git tag v0.0.34
git push origin v0.0.34
```

`.github/workflows/release.yml` runs the quality gates, builds all platform
artifacts, and publishes the release; installed apps on the stable channel
pick it up on their next update check.

## Other platforms

- **Linux**: download the `*-x86_64.AppImage`, `chmod +x`, run. Auto-update
  works through the same release manifests.
- **Windows**: `*-x64.exe` NSIS installer, signed via Azure Trusted Signing.

## Remote workflows

The desktop app on the laptop can also connect to a T3 Code server running
elsewhere (see `REMOTE.md`); deploying the desktop app and pointing it at a
remote environment are independent choices.

## Corporate network note

Downloads and update checks go to `github.com` /
`objects.githubusercontent.com` over HTTPS, which corporate TLS-inspection
proxies (for example Zscaler) generally allow. The committed
`bunfig.toml` cafile entry only matters when developing from a source
checkout, not for the packaged app.

## Related docs

- `docs/release.md`: the full release pipeline and signing setup
- `docs/desktop-build-runbook.md`: building artifacts locally
