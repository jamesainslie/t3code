# Roadmap

The Roadmap holds your planned work as a tree of work items, from objectives down to stories and
bugs. Threads attach to the work items they serve, so you can see what each thread is for. Agents on
attached threads see their work item and can keep it up to date.

Open **Roadmap** from the sidebar or the command palette, or press `mod+alt+r` on web and desktop
when the terminal is not focused. Customize `roadmap.open` in **Settings → Keybindings**.

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

## Agents on attached threads

At the start of every turn, the agent on an attached thread receives a short summary of its work
item and acceptance criteria. Your message in the thread stays as you wrote it. Messages that start
with a `/` command do not include the summary.

Agents can read the roadmap, update their work item, tick criteria with evidence, create items, and
attach threads. An agent cannot mark an item done while any of its criteria are unticked. Items an
agent creates are marked **Needs review** until you open or edit them.

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
