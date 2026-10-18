import { describe, expect, it } from "vite-plus/test";

import { THREAD_SIDE_CARD_WIDTH, resolveSideCardStack } from "./threadSideCardLayout";

const viewport = { width: 1600, height: 1000 };
const header = { top: 0, right: 1580, bottom: 48 };
const iris = { id: "iris", desiredHeight: 300 } as const;
const roadmap = { id: "roadmap", desiredHeight: 300 } as const;

describe("resolveSideCardStack with one card", () => {
  it("stacks under the thread details card, right edges aligned", () => {
    const details = { top: 60, right: 1588, bottom: 460 };
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [iris],
    });
    expect(stack.get("iris")).toEqual({
      mode: "inline",
      top: 468,
      left: 1588 - THREAD_SIDE_CARD_WIDTH,
      maxHeight: 1000 - 468 - 8,
    });
  });

  it("takes the details card's place under the header when there is none", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details: null,
      detailsColumn: true,
      cards: [iris],
    });
    expect(stack.get("iris")).toEqual({
      mode: "inline",
      top: 60,
      left: 1580 - 12 - THREAD_SIDE_CARD_WIDTH,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("keeps the column while the details card leaves enough room below it", () => {
    const details = { top: 60, right: 1588, bottom: 820 };
    const placement = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [iris],
    }).get("iris");
    expect(placement?.mode).toBe("inline");
    expect(placement?.maxHeight).toBe(1000 - 828 - 8);
  });

  it("gives up the column when the details card leaves too little room", () => {
    const details = { top: 60, right: 1588, bottom: 840 };
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [iris],
    });
    expect(stack.get("iris")).toEqual({
      mode: "popover",
      top: 60,
      left: 1588 - THREAD_SIDE_CARD_WIDTH,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("gives up the column when the canvas has none for the details card", () => {
    const placement = resolveSideCardStack({
      viewport: { width: 900, height: 800 },
      header: { top: 0, right: 890, bottom: 48 },
      details: null,
      detailsColumn: false,
      cards: [iris],
    }).get("iris");
    expect(placement?.mode).toBe("popover");
    expect(placement?.top).toBe(60);
  });

  it("stays on screen at the left edge of a narrow window", () => {
    const placement = resolveSideCardStack({
      viewport: { width: 300, height: 800 },
      header: { top: 0, right: 290, bottom: 48 },
      details: null,
      detailsColumn: false,
      cards: [iris],
    }).get("iris");
    expect(placement?.left).toBe(8);
  });

  it("never reports a negative height", () => {
    const placement = resolveSideCardStack({
      viewport: { width: 1600, height: 50 },
      header,
      details: null,
      detailsColumn: true,
      cards: [iris],
    }).get("iris");
    expect(placement?.maxHeight).toBe(0);
  });
});

describe("resolveSideCardStack with several cards", () => {
  const details = { top: 60, right: 1588, bottom: 300 };

  it("stacks each card under the one before it when both fit", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [
        { id: "iris", desiredHeight: 200 },
        { id: "roadmap", desiredHeight: 300 },
      ],
    });
    const left = 1588 - THREAD_SIDE_CARD_WIDTH;
    expect(stack.get("iris")).toEqual({
      mode: "inline",
      top: 308,
      left,
      maxHeight: 1000 - 308 - 8,
    });
    expect(stack.get("roadmap")).toEqual({
      mode: "inline",
      top: 308 + 200 + 8,
      left,
      maxHeight: 1000 - 516 - 8,
    });
  });

  it("sends a later card to a popover when the cards above leave too little room", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [{ id: "iris", desiredHeight: 600 }, roadmap],
    });
    expect(stack.get("iris")?.mode).toBe("inline");
    expect(stack.get("roadmap")).toEqual({
      mode: "popover",
      top: 60,
      left: 1588 - THREAD_SIDE_CARD_WIDTH,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("counts a card taller than its room as filling the room", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [{ id: "iris", desiredHeight: 5000 }, roadmap],
    });
    expect(stack.get("iris")).toMatchObject({ mode: "inline", maxHeight: 1000 - 308 - 8 });
    expect(stack.get("roadmap")?.mode).toBe("popover");
  });

  it("stacks under the header when there is no details card", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details: null,
      detailsColumn: true,
      cards: [iris, roadmap],
    });
    expect(stack.get("iris")?.top).toBe(60);
    expect(stack.get("roadmap")?.top).toBe(60 + 300 + 8);
  });

  it("opens every card as a popover when the details card has no column", () => {
    const stack = resolveSideCardStack({
      viewport: { width: 900, height: 800 },
      header: { top: 0, right: 890, bottom: 48 },
      details: null,
      detailsColumn: false,
      cards: [iris, roadmap],
    });
    expect(stack.get("iris")?.mode).toBe("popover");
    expect(stack.get("roadmap")?.mode).toBe("popover");
  });

  it("follows the order it is given", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      cards: [roadmap, iris],
    });
    expect(stack.get("roadmap")?.top).toBe(308);
    expect(stack.get("iris")?.top).toBe(308 + 300 + 8);
  });
});
