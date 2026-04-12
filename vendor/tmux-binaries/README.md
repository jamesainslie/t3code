# Vendored tmux static binaries

Pre-built static tmux binaries for Linux, used by the SSH remote provisioner
to deploy tmux on remote hosts that don't have it installed.

**Source:** [pythops/tmux-linux-binary](https://github.com/pythops/tmux-linux-binary)
**Version:** v3.6a

## Files

| File | Platform | Size |
|------|----------|------|
| `tmux-linux-x64` | Linux x86_64 | ~2.9 MB |
| `tmux-linux-arm64` | Linux aarch64 | ~2.6 MB |

## Updating

To update to a newer tmux version:

1. Download new binaries from the [releases page](https://github.com/pythops/tmux-linux-binary/releases)
2. Replace the files in this directory
3. Update the version above
4. Commit
