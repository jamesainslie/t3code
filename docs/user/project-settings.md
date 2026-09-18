# Settings and project overrides

On web and desktop, the Settings breadcrumb ends with the environment and project a change applies to. They start
at **All environments** and **All projects** and stay selected as you move between categories or
search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

On mobile, open **Settings** and use the filter in its header to choose connected environments
and a project. The filter stays available in server-setting pages. With **All projects** selected,
the **Server settings** categories and auto-settle controls in **Thread behavior** edit the
selected environments' defaults. Choosing a project edits its overrides on the selected
environments. Use **Use defaults** in a page to remove that page's project overrides.
Open **Settings → Projects & threads → Overview** to rename the project across its selected
connected checkouts and see where those checkouts live.
Settings that are environment-wide stay read-only while a project is selected. When selected
targets disagree, a control shows **Mixed** until you choose one value. Appearance, keyboard,
and other phone-only settings ignore the filter.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Project category, shown while a project is selected, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

For workspace mode, a project's `t3.json` preference applies when the project has no override.
Browser access changes apply when an agent session next starts.

## Storage cleanup

Open **Settings → Storage** to enable automatic cleanup on one machine or all connected
environments. Policies are off by default and run on the server at startup, when changed, and
hourly. Offline machines keep their existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, after merging, or when they
have no commits beyond the default branch. Only T3-managed worktrees are eligible. Active
sessions, shared worktrees, uncommitted changes, and ignored files other than `node_modules`
prevent removal. Branches and thread history stay; starting another turn recreates the checkout.
Merge cleanup requires the commits to be included in the remote default branch, so squash merges
may need the inactivity rule instead.

Enable **Delete worktrees with deleted threads** to remove safe worktrees after their last
thread is deleted, including archived threads and worktrees left by earlier deletions. The
server waits for sessions and terminals to stop and retries skipped worktrees after restart.
Existing prompts for deleting a worktree manually remain available when this policy is off.

Browser captures and rotated logs have separate retention periods. Expired capture links stop
working. Current logs, message attachments, and browser profiles are kept.

## Sync from another T3 install

On web or desktop, open **Settings → Projects & threads** and keep **All projects** selected in the
breadcrumb. Choose the environment running your fork in the breadcrumb, or use **Destination
machine** in the sync section; with a single connected environment it is selected for you. Enter
the main install's T3 home on that machine, usually `~/.t3`, then choose **Preview import**. The
fork must use a separate home, usually `~/.t3f`.

Review each project and choose an existing destination, a separate project, or **Skip**.
Imports include project settings, conversations, attachments, historical tool activity, and
proposed plans. Existing destination settings stay unchanged. Defaults on newly imported
projects follow the source until you edit them in the fork. Project folders must already be
available on the destination machine. Provider credentials, live sessions, and Git checkpoints
are configured separately and are not imported. Remote-host projects are shown as unsupported.

Choose **Import and enable nightly sync**, or turn off the nightly option for a manual import.
Nightly runs default to 03:00 in the destination machine's timezone. A missed night catches up
when the environment runs again. New source projects are discovered automatically; projects
you skipped stay skipped. Active conversations are deferred until a later sync. **Sync now**
retries immediately after a reported failure, and **Pause sync** stops automatic runs.

Newly imported conversations start archived and have a **T3** indicator. You can reopen, settle,
archive, or delete the local copy. These choices survive later syncs and undo without changing the
main install. Deleting an imported copy keeps that source conversation out of future imports.
Conversation content stays read-only. **Continue in fork**, available
on desktop, web, and mobile, starts an independent conversation with the imported history and
attachments as context for a new provider session. Later imports and undo leave that continuation
intact. Changes and deletions in the main install never delete your fork conversations.

In **Sync history**, **Undo this sync** restores the previous imported versions and pauses nightly
sync. Undo the latest active batch first; repeat to undo earlier batches. Later local project edits
remain in place.

Use **Recovery backups** for a full rewind of this environment's database, attachments, and settings.
The seven most recent automatic backups are retained. Preparing a restore pauses sync; quit and
restart the destination environment to apply it, or choose **Cancel restore** before restarting.
Recovery rewinds work recorded since the backup and retains the current state under the T3 home's
`sync-recovery/before-restore-*` directory. It does not rewind files in your Git working directories.
The main install remains unchanged.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

When no image is found, web and desktop show a two-character monogram with a color
from the icon palette, derived from the saved project name. For example, `Nebula` becomes `NA`,
`Silver Orchard` becomes `SO`, and `M7 Forge` becomes `M7`.

## Keep the default branch current

In Source Control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.
On mobile, use **Settings → Source control** to change selected environment defaults or project overrides.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
