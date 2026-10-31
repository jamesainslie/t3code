import { getFiletypeFromFileName } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { resolveDiffThemeName } from "./diffRendering";
import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";

const THEME_NAMES = [
  resolveDiffThemeName("light", "pierre"),
  resolveDiffThemeName("dark", "pierre"),
] as const;

describe("dialect file types", () => {
  it.each([
    ["src/init.luau", "lua"],
    ["styles/page.xsl", "xml"],
    ["styles/page.xslt", "xml"],
  ])("%s highlights as %s", (path, language) => {
    expect(getFiletypeFromFileName(path)).toBe(language);
  });
});

it("caches each language per theme", async () => {
  const [light, dark] = THEME_NAMES;
  const lightHighlighter = getSyntaxHighlighterPromise("typescript", light);
  expect(getSyntaxHighlighterPromise("typescript", light)).toBe(lightHighlighter);
  const darkHighlighter = getSyntaxHighlighterPromise("typescript", dark);
  expect(darkHighlighter).not.toBe(lightHighlighter);
  await Promise.all([lightHighlighter, darkHighlighter]);
});

it.each([
  "asm",
  "assembly",
  "s",
  ...["asm", "ASM", "s", "S", "nasm", "NASM"].map((ext) => `src/start.${ext}`),
])("highlights assembly in %s", async (hint) => {
  const language = hint.includes("/") ? getFiletypeFromFileName(hint) : hint;
  const code = "mov eax, 42 ; answer\nret";
  for (const theme of THEME_NAMES) {
    const highlighter = await getSyntaxHighlighterPromise(language, theme);
    const { tokens } = highlighter.codeToTokens(code, { lang: language, theme });
    expect(tokens.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(code);
    expect(new Set(tokens.flat().map((token) => token.color)).size).toBeGreaterThan(1);
  }
});
