# Remote SSH — Test & Rollback Plan

**Date:** 2026-04-10
**Risk level:** Medium (you are using T3 Code to write T3 Code)
**Environment:** Dev mode from source — NOT a packaged install

---

## Situation Assessment

You run T3 Code in **dev mode** directly from `/Volumes/Code/t3code` source:

- Electron dev app at `apps/desktop/.electron-runtime/T3 Code (Dev).app`
- Dev server: `bun run src/bin.ts` on port 3773
- State: `~/.t3/dev/state.sqlite` (27.7 MB — your full work history)

This is safer than a packaged install because rollback is just `git checkout` + server restart. The only irreversible risk is a **database migration** that corrupts or breaks your state file.

Our change adds **migration 023** (`remote_host_json` column on `projection_projects`). This is additive (ADD COLUMN) — it cannot destroy existing data. But we still back up first.

---

## Phase 0 — Before You Touch Anything

### 0.1 Verify current state is healthy

In T3 Code right now:

- [ ] Open a thread and send a test message — confirm AI responds
- [ ] Open a terminal — confirm it works
- [ ] Note your current git SHA: `git -C /Volumes/Code/t3code rev-parse --short HEAD`

Record it: **Current SHA: \*\***\_\_\_**\*\***

### 0.2 Back up your state database

```bash
cp ~/.t3/dev/state.sqlite ~/.t3/dev/state.sqlite.backup-$(date +%Y%m%d-%H%M%S)
ls -lh ~/.t3/dev/state.sqlite*
```

This is your safety net. If the migration causes any issue, this is what gets restored.

### 0.3 Create a safety branch at current HEAD

```bash
cd /Volumes/Code/t3code
git checkout -b pre-remote-ssh-backup
git checkout main   # or whatever branch you're on
```

Now `pre-remote-ssh-backup` permanently marks your known-good state.

### 0.4 Record the rollback command for use in terminal Claude

**Save the rollback prompt from the bottom of this document to a text file:**

```bash
cat docs/plans/2026-04-10-remote-ssh-rollback-prompt.txt
```

(We'll create that file as part of this plan.)

---

## Phase 1 — Install the New Version

### 1.1 Pull the fork's changes into a test branch

```bash
cd /Volumes/Code/t3code

# Add your fork as a remote if not already there
git remote add fork https://github.com/jamesainslie/t3code.git 2>/dev/null || true

# Fetch latest
git fetch fork

# Create test branch from fork's main
git checkout -b test-remote-ssh fork/main
```

### 1.2 Stop the current dev servers

In your current T3 Code session — finish any active work first, then quit:

- Close T3 Code (Cmd+Q on the Electron app)
- Or kill the dev server process: `pkill -f "bun run src/bin.ts"`

### 1.3 Install dependencies (in case anything changed)

```bash
cd /Volumes/Code/t3code
bun install
```

### 1.4 Rebuild the server and web

```bash
cd /Volumes/Code/t3code
bun run build
```

Expected: clean build. If this fails, **stop here** and see rollback procedure.

### 1.5 Start the new dev version

```bash
cd /Volumes/Code/t3code
bun dev
```

This starts the dev server + Electron app using the new code. The first startup will run migration 023 against your state database.

**Watch the terminal output for:**

- `[migrations] running migration 023` — expected, safe
- Any `[migrations] error` — stop and rollback immediately
- `[server] listening on port 3773` — good

---

## Phase 2 — Local Regression Tests

Before touching the remote SSH feature, verify existing functionality is intact.

### 2.1 Basic health

- [ ] T3 Code opens without crashing
- [ ] Your existing threads and projects are visible (data intact)
- [ ] Send a message in an existing thread — AI responds normally
- [ ] Open a terminal tab — PTY works

### 2.2 Local project operations

- [ ] Create a new local project at `/Volumes/Code/t3code`
- [ ] Open a thread in it
- [ ] Run a simple command in the terminal (e.g., `ls`)
- [ ] Verify git status shows in the UI
- [ ] Verify `bun run test` works from the terminal tab

### 2.3 Sidebar and navigation

- [ ] Sidebar renders all existing projects
- [ ] No new visual glitches or broken layouts
- [ ] Settings panel opens correctly

**If any regression test fails: stop, rollback (see Phase 5).**

---

## Phase 3 — Remote SSH Feature Tests

### 3.1 Pre-requisites

- [ ] Ensure `ssh hephaestus` works in a terminal (SSH agent loaded)
- [ ] Ensure hephaestus is reachable: `ping -c 1 hephaestus.o11y.geicoinf.com`
- [ ] Note a valid remote workspace path: e.g., `/home/jamesainslie/t3-test-project`

Create the test directory on hephaestus first:

```bash
ssh hephaestus "mkdir -p ~/t3-test-project && git -C ~/t3-test-project init 2>/dev/null; echo 'ready'"
```

### 3.2 Add a remote project via the UI

In T3 Code:

- [ ] Click the server/remote icon in the sidebar header
- [ ] Fill in: Host `hephaestus`, User `jamesainslie`, Port `22`, Path `/home/jamesainslie/t3-test-project`
- [ ] Click "Add Remote Project"
- [ ] Watch sidebar for connection status: `provisioning` → `starting` → `connected` (green dot)
- [ ] Note how long provisioning takes (first time installs binaries): **\_** seconds

### 3.3 Verify provisioning

```bash
# On hephaestus — confirm binaries were installed
ssh hephaestus "ls -lh ~/.t3/bin/ && ~/.t3/bin/t3 --version"

# Confirm tmux session exists
ssh hephaestus "~/.t3/bin/tmux list-sessions"

# Confirm state file exists
ssh hephaestus "cat ~/.t3/run/*/server.json"
```

Expected:

- `t3` and `tmux` binaries in `~/.t3/bin/`
- tmux session named `t3-<projectId>`
- server.json with a port number

### 3.4 Use the remote project

- [ ] Open a thread in the remote project
- [ ] Send a message — verify AI agent responds (running on hephaestus)
- [ ] Open a terminal tab — verify `hostname` returns `hephaestus` (not your local machine)
- [ ] Run `echo $TERM` — should return `xterm-256color`
- [ ] Run `pwd` — should return `/home/jamesainslie/t3-test-project`
- [ ] Run `git status` — should work (it's a git repo)

### 3.5 Disconnect/reconnect resilience

- [ ] While connected to hephaestus, kill the SSH tunnel manually:
  ```bash
  pkill -f "ControlPath.*hephaestus"
  ```
- [ ] Watch the sidebar — should show `reconnecting` (yellow) then `connected` (green) automatically
- [ ] Verify the remote session resumed (tmux session was still running)

### 3.6 Laptop sleep simulation

- [ ] Put MacBook to sleep (or close lid for 10 seconds)
- [ ] Wake it up
- [ ] Watch sidebar — should auto-reconnect to hephaestus
- [ ] Open terminal tab — verify it works post-reconnect

### 3.7 Approval-required mode

- [ ] In the remote project, switch thread to `approval-required` mode
- [ ] Start a long AI turn (ask it to do something multi-step)
- [ ] Disconnect the client (Cmd+Q T3 Code)
- [ ] Reopen T3 Code
- [ ] Verify the turn was paused (not completed without you)

### 3.8 Cleanup

```bash
# Remove test installation from hephaestus
ssh hephaestus "~/.t3/bin/tmux kill-server 2>/dev/null; rm -rf ~/.t3/bin ~/.t3/run"
```

---

## Phase 4 — If Everything Passes

The feature is working. Your options:

1. **Keep running on `test-remote-ssh`** — you're already on it, nothing more to do
2. **Merge to your local main** — `git checkout main && git merge test-remote-ssh`
3. **Submit upstream** — open a PR from your fork to `pingdotgg/t3code`

---

## Phase 5 — Rollback Procedure

### When to rollback

- Migration error on startup
- T3 Code crashes on launch
- Existing threads/data missing or corrupted
- Any existing feature broken that was working before

### Rollback steps (run in Terminal.app, NOT in T3 Code)

**Stop everything:**

```bash
pkill -f "bun run src/bin.ts" 2>/dev/null
pkill -f "T3 Code" 2>/dev/null
sleep 2
```

**Restore the database backup:**

```bash
# Find the most recent backup
ls -lt ~/.t3/dev/state.sqlite.backup-* | head -3

# Restore it (replace TIMESTAMP with the one from above)
cp ~/.t3/dev/state.sqlite.backup-TIMESTAMP ~/.t3/dev/state.sqlite
```

**Checkout the known-good code:**

```bash
cd /Volumes/Code/t3code
git checkout pre-remote-ssh-backup
bun install
```

**Restart T3 Code:**

```bash
cd /Volumes/Code/t3code
bun dev
```

**Verify recovery:**

- T3 Code opens
- Your threads are visible
- A test message gets a response

---

## Rollback Prompt for Terminal Claude

> **Save the section below as `/Volumes/Code/t3code/docs/plans/2026-04-10-remote-ssh-rollback-prompt.txt`**
> Feed this to Claude in a normal terminal (`claude` CLI) if T3 Code is broken and you can't use it.

---

```
You are helping me roll back a broken T3 Code installation.
T3 Code is my development environment and it is currently broken.
I cannot use T3 Code — use the terminal only.

DO NOT launch T3 Code or any GUI application.
DO NOT run bun dev or npm start.
Work entirely in the terminal.

Context:
- T3 Code runs in dev mode from source at /Volumes/Code/t3code
- State database: ~/.t3/dev/state.sqlite
- I have a backup at: ~/.t3/dev/state.sqlite.backup-* (find the most recent one)
- I have a safety branch: pre-remote-ssh-backup
- The broken branch is: test-remote-ssh

Steps to execute:

1. Stop all T3 Code processes:
   pkill -f "bun run src/bin.ts" 2>/dev/null
   pkill -f "T3 Code" 2>/dev/null
   pkill -f "vite" 2>/dev/null
   sleep 3
   echo "Processes stopped"

2. Find and restore the most recent state backup:
   BACKUP=$(ls -t ~/.t3/dev/state.sqlite.backup-* 2>/dev/null | head -1)
   if [ -z "$BACKUP" ]; then
     echo "ERROR: No backup found at ~/.t3/dev/state.sqlite.backup-*"
     echo "State database may be unrecoverable. Proceeding with code-only rollback."
   else
     echo "Restoring backup: $BACKUP"
     cp "$BACKUP" ~/.t3/dev/state.sqlite
     echo "Database restored."
   fi

3. Checkout the known-good code:
   cd /Volumes/Code/t3code
   git status
   git stash 2>/dev/null || true
   git checkout pre-remote-ssh-backup
   echo "Code rolled back to: $(git rev-parse --short HEAD)"

4. Reinstall dependencies:
   bun install 2>&1 | tail -3

5. Verify the rollback looks correct:
   git log --oneline -5
   ls ~/.t3/dev/state.sqlite
   echo "Rollback complete. You can now reopen T3 Code manually."

6. Remind the user:
   - To open T3 Code, double-click: /Volumes/Code/t3code/apps/desktop/.electron-runtime/T3\ Code\ \(Dev\).app
   - Or run: bun dev (in /Volumes/Code/t3code) then open the app
   - Verify threads are visible and AI responds before closing this terminal

If any step fails, report the exact error message and stop.
Do not attempt to fix errors silently — surface everything.
```

---

## Quick Reference Card

| Checkpoint       | Command                                                                          | Expected                       |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| Current SHA      | `git -C /Volumes/Code/t3code rev-parse --short HEAD`                             | Note it down                   |
| Backup DB        | `cp ~/.t3/dev/state.sqlite ~/.t3/dev/state.sqlite.backup-$(date +%Y%m%d-%H%M%S)` | File created                   |
| Switch branch    | `git checkout test-remote-ssh`                                                   | No errors                      |
| Start dev        | `bun dev`                                                                        | Port 3773 listening            |
| Check hephaestus | `ssh hephaestus "ls ~/.t3/bin/"`                                                 | t3 and tmux present            |
| Rollback         | See Phase 5 above                                                                | T3 Code opens, threads visible |
