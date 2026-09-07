# Terminal history

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

## Sign in from a terminal

Commands that open a browser, such as `gh auth login`, `codex login`, or
`claude auth login`, run on the environment, where there is no browser to open.
When one asks for a browser, T3 Code shows a banner above that terminal with the
link instead. Choose **Open** to open it on the device you are using, or **Copy**
it into another browser.

Sign-ins that finish on a `127.0.0.1` or `localhost` page are returning to the
command's own listener on the environment, which your browser cannot reach from
another device.

In the desktop app, nothing more is needed. While the banner is showing, T3 Code
stands in for that listener on your computer, so the sign-in can end in any
browser here: the in-app browser, or the one **Open** or **Copy link** took you
to. The final page confirms the result is on its way, and the command in the
terminal continues. If the port the command chose is already in use on your
computer, the banner falls back to the return URL field below.

In a web browser or on mobile, that final page does not load. Copy its full
address, including everything after `?`, into the banner's return URL field and
choose **Continue**. T3 Code delivers it to the command waiting in the terminal.
Some sign-ins, such as `az login`, post their result to that page instead of
putting it in the address, so there is nothing to copy; the banner says so. Open
the link from the desktop app instead, or use the command's device-code option
(for example `az login --use-device-code`).

Device-code sign-ins finish on the provider's website and need nothing pasted.
Watch the terminal output to confirm the command finished. Dismissing the banner
drops the link; run the command again to get a new one. A link is valid for five
minutes.
