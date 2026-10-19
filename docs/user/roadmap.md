# Roadmap

The Roadmap holds your planned work as a tree of work items, from objectives down to stories and
bugs. Threads attach to the work items they serve, so you can see what each thread is for. Agents on
attached threads see their work item and can keep it up to date.

Open **Roadmap** from the sidebar or the command palette, or press `mod+alt+r` on web and desktop
when the terminal is not focused. Customize `roadmap.open` in **Settings → Keybindings**. The
Roadmap opens on **Today**. **Outline**, **Timeline** and **Board** are the other views.

Press `ctrl+tab` to switch between the Roadmap and where you were before it, usually your last
thread. The Roadmap comes back with the view and filters you left it on. Web browsers keep
`ctrl+tab` for switching browser tabs, so in a browser bind `roadmap.toggle` to another key in
**Settings → Keybindings**.

## Create work items

Choose **New** on the Roadmap to add a top-level item, and add children from an item's menu. An
item's type decides where it can sit. Bugs and support tickets go under an epic, feature or story.
Other types go under any type above them, in the order objective, key result, initiative, epic,
feature, story. In the command palette, **Create work item** places the new item under the current
thread's work item when it has one.

To create an item from a thread, right-click the thread in the sidebar and choose **Create work
item from thread**, then a type. The item takes the thread's title and the thread attaches to it.
Turn on **Start a new thread for it** in the same submenu to attach a fresh thread in that project
instead.

## Attach a thread

Choose **Attach to work item…** from the thread's right-click menu, or **Attach this thread to a
work item** from the command palette, then pick the item. Detach it from the same places.

A thread attaches to one work item at a time. When you attach a thread that is already on another
item, Lathe offers **Move here**, which detaches it from its current item and attaches it to the new
one. Creating an item from a thread that is already attached leaves the thread where it is.

An attached thread shows its work item in a card on the thread view. You can tick criteria and
change the item's state there without opening the Roadmap.

## Today

Today lists the open work that needs you now, and every row says why it is there, such as "P0,
untouched 6 working days" or "Due Wed, forecast Fri, at risk". An item appears once, in the first
section that matches:

- **Waiting on you**: an attached thread wants an approval, an answer or a plan review, or finished
  a turn you have not seen, or a pull request linked to it waits for your review. The
  [steward](#the-steward) puts an item here too when it is unsure whether a criterion is met, until
  that criterion is ticked or you remove the note.
- **Your picks**: items you pinned.
- **Due or slipping**: overdue, due within three working days, or forecast to miss the due date.
- **Going cold**: P0 and P1 items with no activity for the area's **Going cold** days. Activity is
  a state change, a ticked criterion, logged hours, or a turn or message on an attached thread.
- **Newly unblocked**: items whose last blocker cleared since you last opened Today on this device.
- **Holding others up**: items that block other open work, most urgent first.

Done and snoozed items stay off Today. So do Backlog items below P1 with no due date, unless you
pinned them or something waits on you.

The header shows each area's capacity, one day of work at your own pace in that area. Lathe measures
the pace from what you finished over the last 15 working days, in the area's unit. Rows past it sit
dimmed under **Beyond today**. Your picks always stay above the line, and **Waiting on you** does
not count against it. A row without an estimate counts as an average finished item and says "no
estimate". An area shows no capacity line until it has at least five completions in that window.

Hover a row to open its thread, start a **New thread** attached to the item, **Snooze** it, mark it
**Done**, or **Pin** it.

## Pin items to Today

Pin an item to keep it under **Your picks**, from its Today row or with **Pin to Today** on its card.
You can pin at most three items. Unpin one before pinning a fourth. Marking an item done unpins it.

## Snooze an item

Snooze takes an item off Today until a date: **Tomorrow**, **Next Monday**, **In a week**, or **Pick
a date…**. Snooze from a Today row or the item's card. The item returns on that date. Until then it
waits under **Snoozed** at the bottom of Today, where **Unsnooze** brings it back early.

## Narrow the Outline

The buttons above the Outline change how it is laid out:

- **Epics**, **Features** or **Stories** lists every item of that type at the top level, with what
  sits under it, and hides the items above. Choose **Tree** for the full tree again.
- **Focus** shows only your focus set and what sits under each item in it. Choose **Select**, tick
  the items you want, then **Focus on** to replace the set. **Add to focus** and **Remove from
  focus** in a row's menu change one item. **Clear focus** empties the set.

The focus set is saved in the Roadmap, so it is the same on every device and agents can see it.
Layouts and filters combine, so Focus with **Stories** and **State: Open** lists the open stories
under your focus set.

## Timeline

**Timeline** shows work items as bars on a calendar, grouped under their top-level item, with blocker
lines between them and sprints along the top. An item needs a due date or a start date to appear.
The note above the chart counts the items left off for lack of dates. Use **Area** to show one area,
and select a bar to open its item.

A bar runs from the item's start date, or the day it was created, to its due date. A dashed
extension past the due date means the forecast lands later. Forecasts divide the work left, in the
area's unit, by your pace in the area. An item is **At risk** when its spare time is under a fifth of the working
days left, and **Late** when the forecast passes the due date.

## Sprints

Choose **Sprints** on the Roadmap to create, edit and delete sprints. A sprint has a name, an area,
and start and end dates. Put an item in a sprint with the **Sprint** field on its card or in the item
editor, which offers the sprints in the item's area. Filter **Outline** by **Sprint** to see one
sprint's items.

Once an area has three finished sprints, items in a sprint forecast from the pace of those three
sprints instead of the last 15 working days. Deleting a sprint takes its items out of it and keeps
the items.

## Import GitHub issues

Choose **Import issue** on the Roadmap, or **Import GitHub issue** in the command palette, and paste
the issue's URL. Pick a parent to put it under, or leave it at the top level in the area you choose.
When the home's `settings.json` maps the repository's GitHub login to an area under
`roadmap.areaByLogin`, such as `{ "jane-work": "work" }`, that area applies instead.
The issue and its sub-issues become work items: an issue with sub-issues becomes an epic, feature or
story by its place in the tree, and one without becomes a story. Importing an issue that is already
on the roadmap opens its item.

Imported items stay in sync with GitHub while the roadmap home is running:

- The title, open or closed, the sub-issue parent, and blocked-by links sync both ways. Parent and
  blocker links sync only when both ends are imported issues. Dates, estimates, priority, criteria
  and notes stay in Lathe.
- Closing the issue sets the item to **Done**, and reopening it sets **In progress**. Marking the
  item **Done** closes the issue, and moving it out of Done reopens it.
- Sub-issues added on GitHub under an imported issue come in on their own.
- When an item and its issue both changed, the newer change wins and the item gets a **Sync** note
  saying what happened.
- Moving an item under a work item that is not an issue removes it from its parent issue on GitHub,
  and a note says so.

Sync uses the roadmap home's GitHub logins, chosen per repository by the rules under **GitHub
accounts** in the home's **Settings → Source Control** (see
[Several GitHub accounts](./source-control.md#several-github-accounts)). A project's own account
choice does not apply, since an imported issue belongs to no project. The home needs a login for
every account whose repositories you import from.
When that login cannot edit an issue, the item's synced fields are read-only, and the card says
why. Open issues are checked every minute and closed ones every 15 minutes. A change you make in
Lathe is sent at once.

An item's card shows its issue number. Choose it to open the issue, or choose the unlink button
beside it to stop syncing. The item stays on the roadmap, and the issue is not changed.

Agents can link pull requests to features, stories, bugs and support tickets. The card lists them,
shows a pull request's details when you hover it, and removes a link you no longer want.

## Log hours

Choose **Log hours** in the **Hours** field of an item's card, enter the hours and an optional note,
and choose **Log**. The same popup lists the item's entries and removes one. Hours count toward
progress and forecasts in areas whose unit is **Hours**.

## Area settings

Each area, Work and Personal, has its own settings in **Settings → Roadmap**. They are saved on the
roadmap home and apply to every client.

- **Unit**: what estimates, progress and pace count. **Points**, **Hours**, **Items** or
  **Criteria**. Defaults to **Points**.
- **Working days**: the weekdays that count toward working days left, pace and forecasts. Defaults to
  Monday to Friday.
- **Going cold**: how many working days without activity put a P0 or P1 item under **Going cold**.
  Defaults to 5.
- **Steward**: whether the [steward](#the-steward) reads this area's attached threads. Off by
  default.

## Agents on attached threads

At the start of every turn, the agent on an attached thread receives a short summary of its work
item and acceptance criteria, with its forecast and progress when it has them. Your message in the
thread stays as you wrote it. Messages that start with a `/` command do not include the summary.

Agents can read the roadmap, update their work item, tick criteria with evidence, log hours, add
progress notes, create items, attach threads, import GitHub issues, and link pull requests. The **Notes** section of an item's card shows the
latest notes, newest first, and removes one you no longer want. When an agent reads a work item it also sees the forecast, progress and
pace. An agent cannot mark an item done while any of its criteria are unticked. Items an agent
creates are marked **Needs review** until you open or edit them. Pins, snoozes and sprints are yours
alone, and agents cannot change them.

Agents work from the server's calendar, which is UTC. Near midnight, the forecast an agent sees can
be a day off from the one on your Roadmap.

## The steward

The steward is a background agent that reads attached threads and relates their work to the item's
acceptance criteria. Turn it on per area with the **Steward** switch in **Settings → Roadmap**.

After a turn ends on an attached thread, and once a day, it reads the turns since its last look and
can:

- Tick a criterion when a turn shows concrete evidence, such as a commit or a passing test. The tick
  is labelled **Steward** on the card, with the thread, the turn number and the evidence.
- Add an **Unsure** note when a turn suggests a criterion is met but the evidence is partial. These
  notes put the item under **Waiting on you** on Today.
- Add a **Drift** note when the thread works on something the item does not describe, and a short
  progress note.

It never unticks a criterion, changes an item's fields, priority, due date or state, or marks
anything done. If you untick a criterion, the steward ticks it again only for a turn that ended after
you unticked it.

Each environment runs its own steward over the threads it owns, on the model you choose in
**Settings → Roadmap → Steward model** on that environment. A small model is enough. Off uses the
text generation model. With a Claude model, its calls show in that environment's **Usage**.

Agents on threads that run on another environment reach the roadmap once that environment is
linked to the roadmap home. See [Link a second environment](#link-a-second-environment).

## Choose the roadmap home

One environment holds the roadmap, the roadmap home. By default it is your main environment: the
desktop app's local environment, or the server you opened the web app from. To use another one, open
**Settings → Roadmap** and choose it under **Roadmap home**.

The home is set per environment. Set it on each of your environments. An environment left on **This
environment** keeps a separate roadmap of its own, and agents there use that one instead.

Changing the home does not move any work items. The new home shows its own roadmap, and the old
items stay on the previous home.

## Link a second environment

An environment that is not the roadmap home needs a link to the home before its agents can use the
roadmap. Linking needs an administrative session on both environments.

1. Connect this client to both environments.
2. Open **Settings → Roadmap** and select the environment you want to link.
3. Under **Roadmap home**, choose the home. Lathe links the environment straight away.

The link uses the address this client reaches the home at. If the environment reaches the home
another way, such as over Tailscale, change the address under **Link to the roadmap home** and
choose **Link again**.

**Link status** shows whether the home is answering. While the home is offline, changes agents make
wait on their own environment and are sent in order once the home is back. Their tools report such
a change as queued. Agents keep the last copy of their work item, marked as possibly out of date.
A change the home refuses is counted under **Link status** and is not sent again.

To end a link, choose **Unlink**. You can also revoke the link's session on the home, under
**Settings → Connections**.
