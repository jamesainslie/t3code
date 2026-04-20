import { describe, expect, it } from "vitest";

import { SETTINGS_NAV_ITEMS } from "../SettingsSidebarNav";

describe("SETTINGS_NAV_ITEMS", () => {
  it("exposes the Markdown renderer settings section", () => {
    expect(SETTINGS_NAV_ITEMS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Markdown",
          to: "/settings/markdown",
        }),
      ]),
    );
  });
});
