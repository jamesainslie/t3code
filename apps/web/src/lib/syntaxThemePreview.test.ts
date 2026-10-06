import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  SYNTAX_THEME_PREVIEW_DELAY_MS,
  getSyntaxThemePreview,
  previewSyntaxTheme,
  subscribeSyntaxThemePreview,
} from "./syntaxThemePreview";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  previewSyntaxTheme(null);
  vi.useRealTimers();
});

it("applies a previewed theme once browsing settles", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeSyntaxThemePreview(listener);

  previewSyntaxTheme("graphite");
  previewSyntaxTheme("ink");
  expect(getSyntaxThemePreview()).toBeNull();

  vi.advanceTimersByTime(SYNTAX_THEME_PREVIEW_DELAY_MS);
  expect(getSyntaxThemePreview()).toBe("ink");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it("clears immediately and drops a pending preview", () => {
  previewSyntaxTheme("dusk");
  vi.advanceTimersByTime(SYNTAX_THEME_PREVIEW_DELAY_MS);
  previewSyntaxTheme("frost");

  previewSyntaxTheme(null);
  expect(getSyntaxThemePreview()).toBeNull();
  vi.advanceTimersByTime(SYNTAX_THEME_PREVIEW_DELAY_MS);
  expect(getSyntaxThemePreview()).toBeNull();
});
