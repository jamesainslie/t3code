import { describe, expect, it } from "vite-plus/test";

import { PROXY_CARD_WIDTH, resolveProxyCardPlacement } from "./proxyStatusCardLayout";

const viewport = { width: 1600, height: 1000 };
const header = { top: 0, right: 1580, bottom: 48 };

describe("resolveProxyCardPlacement", () => {
  it("stacks under the thread details card, right edges aligned", () => {
    const details = { top: 60, right: 1588, bottom: 460 };
    expect(resolveProxyCardPlacement({ viewport, header, details })).toEqual({
      top: 468,
      left: 1588 - PROXY_CARD_WIDTH,
      maxHeight: 1000 - 468 - 8,
    });
  });

  it("takes the details card's place under the header when there is none", () => {
    expect(resolveProxyCardPlacement({ viewport, header, details: null })).toEqual({
      top: 60,
      left: 1580 - 12 - PROXY_CARD_WIDTH,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("rises over the details card's foot rather than running off screen", () => {
    const details = { top: 60, right: 1588, bottom: 960 };
    const placement = resolveProxyCardPlacement({ viewport, header, details });
    expect(placement.maxHeight).toBe(240);
    expect(placement.top).toBe(1000 - 8 - 240);
  });

  it("never rises above the header", () => {
    const short = { width: 1600, height: 260 };
    const details = { top: 60, right: 1588, bottom: 250 };
    const placement = resolveProxyCardPlacement({ viewport: short, header, details });
    expect(placement.top).toBe(header.bottom + 8);
    expect(placement.maxHeight).toBe(260 - 56 - 8);
  });

  it("stays on screen at the left edge of a narrow window", () => {
    const narrow = { width: 300, height: 800 };
    const placement = resolveProxyCardPlacement({
      viewport: narrow,
      header: { top: 0, right: 290, bottom: 48 },
      details: null,
    });
    expect(placement.left).toBe(8);
  });
});
