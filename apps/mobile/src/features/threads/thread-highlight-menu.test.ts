import type { ThreadHighlightPalette } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadHighlightMenuAction,
  resolveThreadHighlightMenuSelection,
} from "./thread-highlight-menu";

const palette: ThreadHighlightPalette = [
  { label: "Red", color: "#ff0000" },
  { label: "Blue", color: "#0000FF" },
];

describe("buildThreadHighlightMenuAction", () => {
  it("checks Default when the thread has no highlight", () => {
    expect(buildThreadHighlightMenuAction({ palette, currentColor: null })).toEqual({
      id: "highlight",
      title: "Highlight",
      image: "paintpalette",
      subactions: [
        { id: "highlight:default", title: "Default", state: "on" },
        { id: "highlight:0", title: "Red", state: undefined },
        { id: "highlight:1", title: "Blue", state: undefined },
      ],
    });
  });

  it("checks the palette entry matching the current color, ignoring case and whitespace", () => {
    const action = buildThreadHighlightMenuAction({ palette, currentColor: " #0000ff " });
    expect(action.subactions).toEqual([
      { id: "highlight:default", title: "Default", state: undefined },
      { id: "highlight:0", title: "Red", state: undefined },
      { id: "highlight:1", title: "Blue", state: "on" },
    ]);
  });

  it("checks nothing when the current color is not in the palette", () => {
    const action = buildThreadHighlightMenuAction({ palette, currentColor: "#123456" });
    expect(action.subactions?.every((subaction) => subaction.state === undefined)).toBe(true);
  });
});

describe("resolveThreadHighlightMenuSelection", () => {
  it("clears the highlight for Default", () => {
    expect(resolveThreadHighlightMenuSelection("highlight:default", palette)).toEqual({
      color: null,
    });
  });

  it("maps a palette index to its color", () => {
    expect(resolveThreadHighlightMenuSelection("highlight:1", palette)).toEqual({
      color: "#0000FF",
    });
  });

  it("ignores unknown ids and out-of-range indexes", () => {
    expect(resolveThreadHighlightMenuSelection("pin", palette)).toBeNull();
    expect(resolveThreadHighlightMenuSelection("highlight:2", palette)).toBeNull();
    expect(resolveThreadHighlightMenuSelection("highlight:-1", palette)).toBeNull();
    expect(resolveThreadHighlightMenuSelection("highlight:abc", palette)).toBeNull();
    expect(resolveThreadHighlightMenuSelection("highlight:", palette)).toBeNull();
  });
});
