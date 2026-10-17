import { describe, expect, it } from "vite-plus/test";

import { PROXY_CARD_WIDTH, resolveProxyCardPlacement } from "./proxyStatusCardLayout";

const viewport = { width: 1600, height: 1000 };
const header = { top: 0, right: 1580, bottom: 48 };

describe("resolveProxyCardPlacement", () => {
  it("stacks under the thread details card, right edges aligned", () => {
    const details = { top: 60, right: 1588, bottom: 460 };
    expect(resolveProxyCardPlacement({ viewport, header, details, detailsColumn: true })).toEqual({
      mode: "inline",
      top: 468,
      left: 1588 - PROXY_CARD_WIDTH,
      maxHeight: 1000 - 468 - 8,
    });
  });

  it("takes the details card's place under the header when there is none", () => {
    expect(
      resolveProxyCardPlacement({ viewport, header, details: null, detailsColumn: true }),
    ).toEqual({
      mode: "inline",
      top: 60,
      left: 1580 - 12 - PROXY_CARD_WIDTH,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("keeps the column while the details card leaves enough room below it", () => {
    const details = { top: 60, right: 1588, bottom: 820 };
    const placement = resolveProxyCardPlacement({ viewport, header, details, detailsColumn: true });
    expect(placement.mode).toBe("inline");
    expect(placement.maxHeight).toBe(1000 - 828 - 8);
  });

  it("gives up the column when the details card leaves too little room", () => {
    const details = { top: 60, right: 1588, bottom: 840 };
    expect(resolveProxyCardPlacement({ viewport, header, details, detailsColumn: true })).toEqual({
      mode: "popover",
      top: 60,
      left: 1588 - PROXY_CARD_WIDTH,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("gives up the column when the canvas has none for the details card", () => {
    const placement = resolveProxyCardPlacement({
      viewport: { width: 900, height: 800 },
      header: { top: 0, right: 890, bottom: 48 },
      details: null,
      detailsColumn: false,
    });
    expect(placement.mode).toBe("popover");
    expect(placement.top).toBe(60);
  });

  it("stays on screen at the left edge of a narrow window", () => {
    const placement = resolveProxyCardPlacement({
      viewport: { width: 300, height: 800 },
      header: { top: 0, right: 290, bottom: 48 },
      details: null,
      detailsColumn: false,
    });
    expect(placement.left).toBe(8);
  });

  it("never reports a negative height", () => {
    const placement = resolveProxyCardPlacement({
      viewport: { width: 1600, height: 50 },
      header,
      details: null,
      detailsColumn: true,
    });
    expect(placement.maxHeight).toBe(0);
  });
});
