import { describe, expect, it } from "vite-plus/test";

import { resolveSideCardStack } from "./threadSideCardLayout";

const viewport = { width: 1600, height: 1000 };
const header = { top: 0, right: 1580, bottom: 48 };
const width = 280;
const card = (top: number, right: number, bottom: number) => ({
  top,
  right,
  bottom,
  width,
  maxWidth: 640,
});
const iris = { id: "iris", desiredHeight: 300 } as const;
const roadmap = { id: "roadmap", desiredHeight: 300 } as const;

describe("resolveSideCardStack with one card", () => {
  it("stacks under the thread details card, right edges aligned", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details: card(60, 1588, 460),
      detailsColumn: true,
      width,
      cards: [iris],
    });
    expect(stack.get("iris")).toEqual({
      mode: "inline",
      top: 468,
      left: 1588 - width,
      width,
      maxWidth: 640,
      maxHeight: 1000 - 468 - 8,
    });
  });

  it("takes the details card's place under the header when there is none", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details: null,
      detailsColumn: true,
      width,
      cards: [iris],
    });
    expect(stack.get("iris")).toEqual({
      mode: "inline",
      top: 60,
      left: 1580 - 12 - width,
      width,
      maxWidth: 640,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("matches the details card's width, even where it narrowed to fit", () => {
    const placement = resolveSideCardStack({
      viewport,
      header,
      details: { top: 60, right: 1588, bottom: 460, width: 300, maxWidth: 300 },
      detailsColumn: true,
      width: 480,
      cards: [iris],
    }).get("iris");
    expect(placement).toMatchObject({ left: 1288, width: 300, maxWidth: 300 });
  });

  it("takes the column width without a details card", () => {
    const placement = resolveSideCardStack({
      viewport,
      header,
      details: null,
      detailsColumn: true,
      width: 420,
      cards: [iris],
    }).get("iris");
    expect(placement).toMatchObject({ left: 1568 - 420, width: 420 });
  });

  it("keeps the column while the details card leaves enough room below it", () => {
    const placement = resolveSideCardStack({
      viewport,
      header,
      details: card(60, 1588, 820),
      detailsColumn: true,
      width,
      cards: [iris],
    }).get("iris");
    expect(placement?.mode).toBe("inline");
    expect(placement?.maxHeight).toBe(1000 - 828 - 8);
  });

  it("gives up the column when the details card leaves too little room", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details: card(60, 1588, 840),
      detailsColumn: true,
      width,
      cards: [iris],
    });
    expect(stack.get("iris")).toEqual({
      mode: "popover",
      top: 60,
      left: 1588 - width,
      width,
      maxWidth: 640,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("gives up the column when the canvas has none for the details card", () => {
    const placement = resolveSideCardStack({
      viewport: { width: 900, height: 800 },
      header: { top: 0, right: 890, bottom: 48 },
      details: null,
      detailsColumn: false,
      width,
      cards: [iris],
    }).get("iris");
    expect(placement?.mode).toBe("popover");
    expect(placement?.top).toBe(60);
  });

  it("stays on screen in a narrow window", () => {
    const placement = resolveSideCardStack({
      viewport: { width: 300, height: 800 },
      header: { top: 0, right: 290, bottom: 48 },
      details: null,
      detailsColumn: false,
      width,
      cards: [iris],
    }).get("iris");
    expect(placement).toMatchObject({ left: 8, width: 270, maxWidth: 270 });
  });

  it("never reports a negative height", () => {
    const placement = resolveSideCardStack({
      viewport: { width: 1600, height: 50 },
      header,
      details: null,
      detailsColumn: true,
      width,
      cards: [iris],
    }).get("iris");
    expect(placement?.maxHeight).toBe(0);
  });
});

describe("resolveSideCardStack with several cards", () => {
  const details = card(60, 1588, 300);

  it("stacks each card under the one before it when both fit", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      width,
      cards: [
        { id: "iris", desiredHeight: 200 },
        { id: "roadmap", desiredHeight: 300 },
      ],
    });
    const left = 1588 - width;
    expect(stack.get("iris")).toEqual({
      mode: "inline",
      top: 308,
      left,
      width,
      maxWidth: 640,
      maxHeight: 1000 - 308 - 8,
    });
    expect(stack.get("roadmap")).toEqual({
      mode: "inline",
      top: 308 + 200 + 8,
      left,
      width,
      maxWidth: 640,
      maxHeight: 1000 - 516 - 8,
    });
  });

  it("sends a later card to a popover when the cards above leave too little room", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      width,
      cards: [{ id: "iris", desiredHeight: 600 }, roadmap],
    });
    expect(stack.get("iris")?.mode).toBe("inline");
    expect(stack.get("roadmap")).toEqual({
      mode: "popover",
      top: 60,
      left: 1588 - width,
      width,
      maxWidth: 640,
      maxHeight: 1000 - 60 - 8,
    });
  });

  it("counts a card taller than its room as filling the room", () => {
    const stack = resolveSideCardStack({
      viewport,
      header,
      details,
      detailsColumn: true,
      width,
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
      width,
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
      width,
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
      width,
      cards: [roadmap, iris],
    });
    expect(stack.get("roadmap")?.top).toBe(308);
    expect(stack.get("iris")?.top).toBe(308 + 300 + 8);
  });
});
