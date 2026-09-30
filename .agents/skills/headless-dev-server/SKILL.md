---
name: headless-dev-server
description: Stand up an isolated T3 Code dev server on a headless host (this fork's usual setup, where the user drives T3 from a desktop over SSH) and reach it from the Browser panel. Use only when a change needs a running app, such as verifying layout, reproducing a UI bug, or capturing before and after screenshots. Tests, lint, and typecheck never need it. Pairs with test-t3-app for driving the panel.
---

# Headless dev server

Start a dev server only when the proof needs a real render. Ask the user first:
it spends time and, on a remote host, needs one command from them. Everything
below is what goes wrong on this fork's headless hosts and how to avoid it.

## 1. Choose the home before starting

- In a git worktree, `vp run dev` keeps state in that worktree's `.t3`. Nothing
  more to do.
- In the main checkout there is no worktree default. Without a flag the server
  uses `~/.t3f/dev`, a directory every main-checkout run shares. Pass an
  explicit, gitignored home instead:

  ```bash
  vp run dev --home-dir "$PWD/.t3" > /tmp/t3-dev.log 2>&1   # run in the background
  ```

  Put the flag straight after `dev`. `vp run dev -- --home-dir ...` hands it to
  the child processes instead: Vite exits with `Unknown option --homeDir` and
  the runner falls back to the shared home.

- Never point it at `~/.t3f/userdata` (the live fork install) or `~/.t3`.

## 2. Seed real data

An empty database proves little. With an explicit home, state lives in
`<home>/userdata`. Snapshot the live database read-only; `VACUUM INTO` is safe
while the live server has it open:

```bash
mkdir -p .t3/userdata && rm -f .t3/userdata/state.sqlite*
bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.t3f/userdata/state.sqlite', { readonly: true }).run(\"VACUUM INTO '.t3/userdata/state.sqlite'\")"
```

If the web build fails on missing modules (common after an upstream sync),
run `vp i` first.

## 3. Read the real ports

Wait for the `[dev-runner]` line and `pairingUrl:` in the log. Confirm
`baseDir=` is the home you chose. Keep the pairing token out of replies,
commits, and screenshots.

## 4. Reach it from the Browser panel

The panel runs in the user's desktop app, often on another machine.
`environment-port` targets and `localhost` URLs resolve on that machine, not
on this host, and Vite binds `localhost`, which can be IPv6 `[::1]` only. So:

1. Check `tailscale status`. If this host is on the user's tailnet, restart
   with `--share` and use its `pairingUrl`.
2. Otherwise ask the user to run, on their machine, and leave open:
   `ssh -N -L <webPort>:localhost:<webPort> <this-host-alias>`.
3. Navigate the panel to `http://localhost:<webPort>/pair#token=...` once.

## 5. Drive it without fighting the link

- The first load pulls hundreds of modules over the forward and takes a minute
  or two. Wait for visible text with `preview_wait_for`; a blank page with
  about 20 elements is still loading.
- Every full navigation reloads all of it. Navigate inside the app where you
  can. Thread routes are `/<environmentId>/<threadId>`; the environment id is
  in `<home>/userdata/environment-id` and differs from the live one.
- Measure layout with `preview_evaluate`. For text alignment, compare where the
  text ends (a `Range` over the element's contents), not the element's box,
  since padding and margins differ between rows.
- For before and after images, `git stash push <file>`, wait for hot reload
  to re-render, capture, then `git stash pop`.

## 6. Keep work content out of evidence

The user's data includes work repositories. The fork is public.

- Capture personal threads, and crop the sidebar and composer out
  (`convert in.png -crop WxH+X+Y +repage out.png`).
- Host PR images in a secret gist under the personal account, never in the
  repository.

## 7. Stop what you started

Stop the dev server by the background task or PID you captured, and any helper
you started. Never kill by pattern. Tell the user they can close their SSH
forward. Leave the seeded `.t3` in place while the user may iterate; it is
gitignored.
