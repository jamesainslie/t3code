import { EnvironmentId, ThreadId } from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import {
  openCommandPalette,
  openRoadmapAttachPicker,
  openThreadDependencyPicker,
} from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { CommandPalette } from "./CommandPalette";

function setup() {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
}

describe("CommandPalette open intents", () => {
  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("carries the fork's thread pickers and new thread callback to the palette", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("t") };
    const onThreadCreated = () => {};

    openThreadDependencyPicker(threadRef);
    expect(useCommandPaletteStore.getState().openIntent).toEqual({
      kind: "depends-on",
      blockedThreadRef: threadRef,
    });

    openRoadmapAttachPicker(threadRef);
    expect(useCommandPaletteStore.getState().openIntent).toEqual({
      kind: "roadmap-attach",
      threadRef,
    });

    openCommandPalette({ open: "new-thread-in", onThreadCreated });
    expect(useCommandPaletteStore.getState().openIntent).toEqual({
      kind: "new-thread-in",
      onThreadCreated,
    });
  });
});
