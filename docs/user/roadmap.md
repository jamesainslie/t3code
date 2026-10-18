# Roadmap

The Roadmap holds your planned work as a tree of work items, from objectives down to stories and
bugs. Threads attach to the work items they serve, so you can see what each thread is for. Agents on
attached threads see their work item and can keep it up to date.

Open **Roadmap** from the sidebar or the command palette, or press `mod+alt+r` on web and desktop
when the terminal is not focused. Customize `roadmap.open` in **Settings → Keybindings**. The
Roadmap opens on **Today**. **Outline**, **Timeline** and **Board** are the other views.

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
  a turn you have not seen, or a pull request linked to it waits for your review.
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

## Agents on attached threads

At the start of every turn, the agent on an attached thread receives a short summary of its work
item and acceptance criteria, with its forecast and progress when it has them. Your message in the
thread stays as you wrote it. Messages that start with a `/` command do not include the summary.

Agents can read the roadmap, update their work item, tick criteria with evidence, log hours, create
items, and attach threads. When an agent reads a work item it also sees the forecast, progress and
pace. An agent cannot mark an item done while any of its criteria are unticked. Items an agent
creates are marked **Needs review** until you open or edit them. Pins, snoozes and sprints are yours
alone, and agents cannot change them.

Agents work from the server's calendar, which is UTC. Near midnight, the forecast an agent sees can
be a day off from the one on your Roadmap.

Agents can reach the roadmap only on threads that run on the roadmap home. Agents on other
environments cannot use it yet.

## Choose the roadmap home

One environment holds the roadmap, the roadmap home. By default it is your main environment: the
desktop app's local environment, or the server you opened the web app from. To use another one, open
**Settings → Roadmap** and choose it under **Roadmap home**.

The home is set per environment. Set it on each of your environments. An environment left on **This
environment** keeps a separate roadmap of its own, and agents there use that one instead.

Changing the home does not move any work items. The new home shows its own roadmap, and the old
items stay on the previous home.
