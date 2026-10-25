import { describe, expect, it } from "vite-plus/test";

import { clampPanelFontSize } from "./appearanceFonts";

describe("clampPanelFontSize", () => {
  it("keeps the right panel font size inside the range the panel can absorb", () => {
    expect(clampPanelFontSize(30)).toBe(20);
    expect(clampPanelFontSize(4)).toBe(12);
    expect(clampPanelFontSize(Number.NaN)).toBe(16);
  });
});
