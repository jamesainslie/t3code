# Terminal runtime

The environment server owns PTYs, session lifetime, and retained output. Every
client, including the desktop renderer, attaches through the environment connection.
This lets clients reconnect or share a running session. Renderer choices stay local
to each client and do not change terminal contracts.

## Output and retention

[Terminal history](../../apps/server/src/terminal/Manager.ts) is incremental.
PTY callbacks append new chunks; live events carry only those chunks. Materializing
or copying full scrollback on every callback makes output cost grow with retained
history, so snapshots and coalesced persistence are the materialization boundaries.
Persistence queues the mutable history buffer and reads its latest value when the
write runs. Clear, restart, and close must drain writes before completing their
lifecycle boundary.

Server history is capped at 5,000 lines and 8 MiB of UTF-8 text per terminal, so a
long unterminated line cannot bypass retention. Eviction removes the oldest output
without splitting Unicode code points; live output is not truncated. Release
discarded chunk references immediately, even if array compaction happens later.
Client buffers have a separate 512 KiB cap. Measure throughput with full scrollback
when changing this path.

Restoration must read only the bounded tail of current or legacy history files,
skip any incomplete UTF-8 prefix, and apply the line limit. Close the read handle
before rewriting the capped file. Reading whole old logs would defeat the memory
bound during startup.

## Renderer ownership

Android and web use the same `libghostty-vt` C ABI for terminal behavior. Platform
adapters own drawing and input integration, and React stays out of terminal frames.
The web adapter shares one WebAssembly instance per browser tab while each terminal
owns and frees its own handles. The canonical upstream pin is
[`native/libghostty-vt/VERSION`](../../native/libghostty-vt/VERSION); both native and
web artifacts must be rebuilt when it changes. Web embeds the revision in its build
info so the ABI check can detect drift without a second pin.

Restoring scrollback must not send terminal replies to the current shell. Historical
device queries can otherwise provoke fresh replies that appear as junk at the
prompt. The server strips query/response traffic from retained history, and the
[web renderer](../../apps/web/src/terminal/ghostty/core.ts) detaches its PTY writer
during replay. Preserve both protections when changing retention or renderer code.

## Browser launches are captured, never opened

The user is at a client, never at the environment, so a browser opened by a
terminal command is always wrong even when the environment has a display. Every
T3 terminal gets `BROWSER` pointed at the
[capture helper](../../apps/server/src/auth-relay/browserLaunchSocket.ts), overriding
any value in the user's environment. The helper cannot report through the PTY: its
stderr is the terminal, and ConPTY re-flows long lines. It connects to a private
local socket the terminal manager owns and presents a token issued for that one
process. The manager records the URL as a
[pending capture](../../apps/server/src/terminal/browserLaunches.ts) and publishes it
to attached clients, which show the link and relay a return URL back through the
generic [loopback replay](../../apps/server/src/auth-relay/loopbackCallback.ts).

Captures die with the process. The desktop strips `ELECTRON_RUN_AS_NODE` from
terminal environments, so the helper is a wrapper script that sets it itself; the
inline `node -e` helper providers use would not run under an Electron runtime
there. Clients opt into the capture events per attach stream so a client built
before they existed keeps decoding the stream.

The desktop in-app browser can close the loop without a paste. A tab opened for a
capture is tagged with the capture's loopback target through the preview bridge;
the [preview manager](../../apps/desktop/src/preview/Manager.ts) cancels the
matching return navigation (a server-side redirect only `will-redirect` can
cancel), hands the URL to the renderer, and loads a plain confirmation page. The
tag is consumed by that one navigation and untagged tabs navigate normally. Web
and mobile cannot intercept the OS browser, so the paste field stays the primary
path there.
