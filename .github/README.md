# Lathe

Lathe is a fork of [T3 Code](https://github.com/pingdotgg/t3code), a minimal GUI for coding agents. It follows upstream closely, adds its own changes on top, and installs beside T3 Code without sharing any state with it.

Lathe works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. Install and sign in to at least one of them first, as [upstream's installation notes](../README.md#installation) describe.

## Installation

### Command line

```bash
npx @jamesainslie/lathe@nightly
```

Or install it globally with `npm install -g @jamesainslie/lathe@nightly` and run `lathe`. `lathe service install` keeps it running in the background, `lathe update` moves to a newer release, and `lathe --help` has the full reference.

### Desktop app

Download Lathe (Nightly) from [GitHub Releases](https://github.com/jamesainslie/t3code/releases): a signed DMG for macOS on Apple silicon and Intel, or an AppImage for Linux on x64 and arm64. Windows is not built. The desktop app updates itself.

## Beside T3 Code

|                | T3 Code     | Lathe                                |
| -------------- | ----------- | ------------------------------------ |
| Command        | `t3`        | `lathe`                              |
| npm package    | `t3`        | `@jamesainslie/lathe`                |
| Default port   | 3773        | 4773                                 |
| Data directory | `~/.t3`     | `~/.lathe` (or an existing `~/.t3f`) |
| URL scheme     | `t3code://` | `lathe://`                           |

Lathe uses T3 Connect and the hosted web app at app.t3.codes unchanged, so their accounts and pairing work the same way. To bring projects and conversation history over from T3 Code, use **Settings → Projects → Sync from another T3 Code install**.

## Documentation

The guides under [docs/user](../docs/user) are upstream's. Where they say T3 Code or `t3`, read Lathe or `lathe`.

## Reporting problems

Run `lathe triage` to start an agent session that diagnoses your install and drafts an issue, or [open an issue](https://github.com/jamesainslie/t3code/issues) here. Please do not report Lathe problems to upstream.

## License

MIT, like upstream. Lathe is a fork of T3 Code by T3 Tools.
