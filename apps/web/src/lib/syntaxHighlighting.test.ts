import type { DiffsHighlighter } from "@pierre/diffs";
import { expect, it, vi } from "vite-plus/test";

const { getSharedHighlighter } = vi.hoisted(() => ({
  getSharedHighlighter: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter,
}));

import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";

it("caches the recovered text highlighter for unsupported languages", async () => {
  const textHighlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockImplementation(({ langs }: { langs: string[] }) =>
    langs[0] === "text"
      ? Promise.resolve(textHighlighter)
      : Promise.reject(new Error("unsupported language")),
  );

  const first = getSyntaxHighlighterPromise("unsupported-test-language", "pierre-dark");
  await expect(first).resolves.toBe(textHighlighter);
  const second = getSyntaxHighlighterPromise("unsupported-test-language", "pierre-dark");

  expect(second).toBe(first);
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);
});

it("loads the requested theme and caches each language per theme", async () => {
  getSharedHighlighter.mockReset();
  const highlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockResolvedValue(highlighter);

  const graphite = getSyntaxHighlighterPromise("typescript", "t3-graphite-dark");
  await expect(graphite).resolves.toBe(highlighter);
  expect(getSyntaxHighlighterPromise("typescript", "t3-graphite-dark")).toBe(graphite);
  await getSyntaxHighlighterPromise("typescript", "pierre-dark");

  expect(getSharedHighlighter.mock.calls.map(([options]) => options.themes)).toEqual([
    ["t3-graphite-dark"],
    ["pierre-dark"],
  ]);
});
