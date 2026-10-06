import { Edition } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EDITIONS, getEdition } from "./editions";

describe("editions", () => {
  it("presents every edition the settings contract accepts, once", () => {
    // getEdition falls back to the tartan, so a missing entry would fail silently.
    expect(EDITIONS.map((edition) => edition.id).toSorted()).toEqual(
      [...Edition.literals].toSorted(),
    );
  });

  it("gives each edition its own name", () => {
    const labels = EDITIONS.map((edition) => edition.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("looks editions up by id", () => {
    expect(getEdition("amber").label).toBe("Amber Terminal");
  });
});
