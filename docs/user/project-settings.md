# Project settings

Open **Settings → Projects**. The project and machine pickers start at **All projects** and
**All machines**.

Change the default model, workspace, automatic pull, agent browser access, or actions for projects that inherit those values.
Select an individual project to override a default. Reset its row to inherit again. Changing a
default preserves explicit project overrides. Workspace preferences in `t3.json` take precedence
over machine defaults when the project has no explicit workspace override.

Select a machine to limit edits to it. **All machines** writes defaults to connected machines;
offline machines keep their previous values. Mixed values are indicated when selected machines
or checkouts disagree. Browser access changes apply when an agent session next starts.

Project grouping has a client-wide default across machines, with individual checkout overrides.
Shared actions apply to inheriting projects; editing a project's actions creates an independent list.
Reset that list to use shared actions again. Existing project actions are preserved.

Project names, icons, removal, and importing actions from a checkout remain project-specific.
When there are several checkouts, the checkout picker selects which actions and grouping to edit.

## Sync from another T3 install

On web or desktop, open **Settings → Projects** and choose **All projects**. Under **All machines**,
use **Destination machine** in the sync section to select the machine running your fork. You can
also select its machine tab directly. Enter the main install's T3 home on that machine, usually
`~/.t3`, then choose **Preview import**. The fork must use a separate home, usually `~/.t3f`.

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

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
