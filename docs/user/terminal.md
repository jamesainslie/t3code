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

Sign-ins that finish on a `127.0.0.1` or `localhost` page cannot reach the
environment from another device, so that final page does not load. Copy the
page's full address, including everything after `?`, into the banner's return
URL field and choose **Continue**. T3 Code delivers it to the command waiting in
the terminal. Watch the terminal output to confirm the command finished.

Device-code sign-ins finish on the provider's website and need nothing pasted.
Dismissing the banner drops the link; run the command again to get a new one.
A link is valid for five minutes.
