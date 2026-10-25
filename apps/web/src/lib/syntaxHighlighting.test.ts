import type { DiffsHighlighter } from "@pierre/diffs";
import { expect, it, vi } from "vite-plus/test";

const { getSharedHighlighter } = vi.hoisted(() => ({
  getSharedHighlighter: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter,
}));

import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";

it("loads the requested theme and caches each language per theme", async () => {
  const highlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockResolvedValue(highlighter);

  const graphite = getSyntaxHighlighterPromise("typescript", "lathe-graphite-dark");
  await expect(graphite).resolves.toBe(highlighter);
  expect(getSyntaxHighlighterPromise("typescript", "lathe-graphite-dark")).toBe(graphite);
  await getSyntaxHighlighterPromise("typescript", "pierre-dark");

  expect(getSharedHighlighter.mock.calls.map(([options]) => options.themes)).toEqual([
    ["lathe-graphite-dark"],
    ["pierre-dark"],
  ]);
});
