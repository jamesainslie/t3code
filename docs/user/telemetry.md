# Product usage data

Lathe sends no product usage data unless you turn it on.

To share usage data with T3 Tools, the makers of T3 Code, set `T3CODE_TELEMETRY_ENABLED=true` in
the server's environment before starting it. The server then sends product usage events to T3
Tools' PostHog project, associated with a hashed account or installation identifier. Events
include the provider, model, reasoning effort, permission mode, turn result, duration, and
main-agent token totals when available.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

The desktop app reads the variable from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.
