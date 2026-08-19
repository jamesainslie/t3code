# Deploying T3 Code to another machine

How to get this fork's builds onto a machine you use daily (for example a
work laptop), without running from a source checkout.

## TL;DR (macOS work laptop)

1. Open the fork's [GitHub Releases](https://github.com/jamesainslie/t3code/releases).
2. Download the DMG for your architecture from the newest release in your
   chosen channel (Apple Silicon: `*-arm64.dmg`).
3. Drag the app to Applications and launch it. Fork builds are ad-hoc signed
   (no Apple secrets configured), so Gatekeeper blocks the first launch:
   right-click the app, choose Open, and confirm; or clear quarantine with
   `xattr -dc "/Applications/T3 Code.app"`. Configure the Apple signing
   secrets from `docs/release.md` section 2 to get signed, notarized builds.
4. Updates: the app checks GitHub Releases in the background and shows a
   rocket button when one is available. No token is needed (the repo is
   public). Caveat: macOS refuses to install updates into an ad-hoc signed
   app, so until signing secrets are configured, update by downloading the
   new DMG manually.

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

Fork operational notes:

- The fork runs on GitHub-hosted runners (the upstream workflow uses paid
  Blacksmith runners the fork does not have; the labels are swapped in the
  fork's workflow files with the originals kept as comments).
- The npm CLI publish job is skipped on forks; only upstream owns the `t3`
  package.
- GitHub auto-disables scheduled workflows after roughly 60 days without
  repo activity. If nightlies stop, re-enable with
  `gh workflow enable release.yml`.

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
