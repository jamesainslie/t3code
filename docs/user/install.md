# Install Lathe

Lathe runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Lathe and configure providers afterwards.

## Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

This installs the `lathe` binary to `~/.local/bin`. If your shell reports `command not found`
afterwards, that directory is not on your `PATH` yet; the installer prints the
line to add. Set `LATHE_CHANNEL=nightly` to install the nightly train, or
`LATHE_VERSION` to pin an exact version.

| Task                                             | Command                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Start the server and open the web app            | `lathe`                                                                    |
| Start the server without a browser               | `lathe serve`                                                              |
| Use it from your other devices                   | `lathe up` ([details](./remote-access.md))                                 |
| Keep it running in the background (macOS, Linux) | `lathe service install` ([details](./background-service.md))               |
| Move to the newest release                       | `lathe update`                                                             |
| Reclaim database space                           | `lathe doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                                  | `lathe uninstall`                                                          |

Run `lathe help` or `lathe --help` for the full reference. To start in a new working
directory, use an explicit path such as `lathe ./my-project`. A bare directory name
is accepted only if it already exists.

If `lathe` or `lathe start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

To try Lathe once without installing it, run `npx @jamesainslie/lathe@latest` instead (needs
Node.js for `npx`).

### Intel Macs

There is no `lathe` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with `vp`, which provides the Node version it needs
([Install vp](https://github.com/pingdotgg/t3code#install-vp)):

```bash
git clone https://github.com/pingdotgg/t3code
cd lathe && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`lathe update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download a release from [GitHub Releases](https://github.com/pingdotgg/t3code/releases),
or use a package manager:

| Platform           | Install                                                     |
| ------------------ | ----------------------------------------------------------- |
| Windows            | `winget install T3Tools.T3Code`                             |
| macOS              | `brew install --cask t3-code`                               |
| Debian, Ubuntu     | `sudo apt install ./Lathe-*.deb`                            |
| Arch Linux         | `yay -S lathe-bin`                                          |
| Arch Linux nightly | `yay -S lathe-nightly-bin`                                  |
| Nix                | `nix profile add github:NixOS/nixpkgs/nixos-unstable#lathe` |

The `.deb` updates itself like the other desktop builds. It asks for your
password to install each update. If your desktop has no password prompt, the
update fails. Download the new `.deb` and install it the same way.

### Nix (nixpkgs)

Lathe is maintained in [nixpkgs](https://github.com/NixOS/nixpkgs/tree/nixos-unstable/pkgs/by-name/lathe/t3code).
The command above installs from `nixos-unstable` and requires Nix 2.30 or later with
`nix-command` and `flakes` enabled. Launch the desktop app with `t3code-desktop`;
the package also includes the `lathe` command.

On NixOS, you can instead add the package to your system configuration, using
a nixpkgs revision that includes `lathe`:

```nix
environment.systemPackages = [ pkgs.lathe ];
```

Apply the change with `sudo nixos-rebuild switch`. For Home Manager, add
`pkgs.lathe` to `home.packages` and run `home-manager switch`.

Update a profile installation with `nix profile upgrade lathe`. For NixOS or
Home Manager, update your configuration's nixpkgs input or channel and rebuild.
Nix manages both the desktop app and the bundled
`lathe` command; use Nix to update them instead of the in-app updater or `lathe update`.

### The `lathe` command

The desktop app includes the `lathe` command-line tool. To run it from any
terminal, open **Settings → About** and choose **Install** next to
**lathe command**. On macOS and Linux it adds a `lathe` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again. If you already have `lathe`
from npm, it stays as it is.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. Lathe installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
lathe app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `lathe app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install Lathe from the
[App Store](https://apps.apple.com/us/app/lathe-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.lathetools.lathe).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through T3 Connect or a pairing URL.

Store links and QR codes are also available in **Settings → About → Mobile app**
on web and desktop. The store apps work with both stable and Nightly servers. Test builds are optional:

- **iPhone and iPad:** TestFlight is invite-only.
- **Android:** download an APK from the
  [Android beta releases](https://github.com/pingdotgg/t3code/releases?q=android-beta-).

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Lathe's provider settings.                                                                                           |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx          | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |

Provider CLIs must be on the server's `PATH`. If Lathe cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Lathe warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when Lathe cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with Lathe. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Lathe does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md),
[Muse Code](./providers-muse.md), and [fx](./providers-fx.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Lathe](./updating.md): update the app and connected servers.
