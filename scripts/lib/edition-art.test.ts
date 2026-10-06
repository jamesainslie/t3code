import { describe, expect, it } from "vite-plus/test";

import {
  editionIconSvg,
  editionMacIconSvg,
  editionStripSvg,
  GENERATED_EDITIONS,
  type IconEdition,
} from "./edition-art.ts";

const ICON_EDITIONS: ReadonlyArray<IconEdition> = [...GENERATED_EDITIONS, "tartan"];

const definedIds = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const referencedIds = (svg: string) =>
  [...svg.matchAll(/(?:url\(#|href="#)([^)"]+)/g)].map((match) => match[1]);

describe("edition art", () => {
  it.each(GENERATED_EDITIONS)("renders the %s strip identically on every run", (edition) => {
    expect(editionStripSvg(edition)).toBe(editionStripSvg(edition));
  });

  it.each(ICON_EDITIONS)("renders the %s icons identically on every run", (edition) => {
    expect(editionIconSvg(edition)).toBe(editionIconSvg(edition));
    expect(editionMacIconSvg(edition)).toBe(editionMacIconSvg(edition));
  });

  it.each(GENERATED_EDITIONS)("draws %s text as paths, never fonts", (edition) => {
    // Strips load as images, which cannot reach the page's fonts.
    expect(editionStripSvg(edition)).not.toMatch(/<text[\s>]/);
  });

  it.each(
    ICON_EDITIONS.flatMap((edition) => [
      [`${edition} icon`, editionIconSvg(edition)],
      [`${edition} macOS icon`, editionMacIconSvg(edition)],
    ]),
  )("gives the %s unique ids that resolve", (_label, svg) => {
    const ids = definedIds(svg);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of referencedIds(svg)) expect(ids).toContain(reference);
  });

  it.each(GENERATED_EDITIONS)("gives the %s strip unique ids that resolve", (edition) => {
    const svg = editionStripSvg(edition);
    const ids = definedIds(svg);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of referencedIds(svg)) expect(ids).toContain(reference);
  });

  it("writes boot log glyphs from the pixel font", () => {
    // The amber strip's first line starts with B, whose top row is two lit cells.
    expect(editionStripSvg("amber")).toContain('d="M0 0h1.7v0.85h-1.7z');
  });
});
