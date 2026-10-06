import { describe, expect, it } from "vite-plus/test";

import { getEdition } from "./editions";
import { applyEditionAccent, resolveEditionAccent } from "./editionAccent";

// The unit project has no DOM; a minimal root records the inline custom properties and
// dataset the real element exposes.
function makeRoot() {
  const properties = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const root = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    dataset,
  } as unknown as HTMLElement;
  return { root, properties, dataset };
}

describe("edition accent", () => {
  it("follows the shown edition while the accent switch is on", () => {
    expect(resolveEditionAccent({ artworkEdition: "amber", accentEnabled: true })).toBe(
      getEdition("amber").accent,
    );
  });

  it("stays off when the user turned it off or no artwork shows", () => {
    expect(resolveEditionAccent({ artworkEdition: "amber", accentEnabled: false })).toBeNull();
    expect(resolveEditionAccent({ artworkEdition: null, accentEnabled: true })).toBeNull();
  });

  it("sets and clears the accent on the root", () => {
    const { root, properties, dataset } = makeRoot();

    applyEditionAccent(root, "#ffb000");
    expect(dataset.editionAccent).toBe("");
    expect(properties.get("--edition-accent")).toBe("#ffb000");

    applyEditionAccent(root, null);
    expect(dataset.editionAccent).toBeUndefined();
    expect(properties.has("--edition-accent")).toBe(false);
  });
});
