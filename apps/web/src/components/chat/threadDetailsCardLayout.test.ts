import { describe, expect, it } from "vite-plus/test";
import {
  resolveThreadDetailsCardDensity,
  resolveThreadDetailsCardLayout,
} from "./threadDetailsCardLayout";

const lane = { padding: 48, minChatWidth: 640 };
const resolve = (width: number, height: number, previewY: number | null = null) =>
  resolveThreadDetailsCardLayout({
    container: { width, height },
    lane,
    frame: previewY === null ? null : { x: width - 332, y: previewY, width: 320, height: 240 },
  });

describe("workspace card", () => {
  it("pins to the top right at the default column width", () => {
    expect(resolve(1600, 900)).toEqual({
      x: 1308,
      right: 12,
      y: 12,
      width: 280,
      maxWidth: 640,
      height: 876,
    });
    expect(resolve(1344, 900)).toMatchObject({ x: 1052, width: 280 });
  });
  it("starts below the open find bar, keeping the bottom inset", () => {
    expect(
      resolveThreadDetailsCardLayout({
        container: { width: 1600, height: 900 },
        lane,
        frame: null,
        topInset: 48,
      }),
    ).toEqual({ x: 1308, right: 12, y: 60, width: 280, maxWidth: 640, height: 828 });
  });
  it("takes the width the user dragged it to", () => {
    expect(
      resolveThreadDetailsCardLayout({
        container: { width: 1600, height: 900 },
        lane,
        width: 420,
        frame: null,
      }),
    ).toMatchObject({ x: 1168, width: 420 });
  });
  it("narrows to keep a readable chat lane before it hides", () => {
    const place = (containerWidth: number) =>
      resolveThreadDetailsCardLayout({
        container: { width: containerWidth, height: 900 },
        lane,
        width: 480,
        frame: null,
      });
    expect(place(1212)).toMatchObject({ x: 720, width: 480, maxWidth: 480 });
    expect(place(1100)).toMatchObject({ x: 720, width: 368, maxWidth: 368 });
    expect(place(972)).toMatchObject({ x: 720, width: 240 });
    expect(place(971)).toBeNull();
  });
  it("hides when a readable chat lane cannot fit beside it", () => {
    expect(resolve(1012, 900)).toMatchObject({ x: 720 });
    expect(resolve(972, 900)).toMatchObject({ x: 720, width: 240 });
    expect(resolve(971, 900)).toBeNull();
  });
  it("keeps the card at the top right while the preview is freely dragged vertically", () => {
    for (const y of [12, 170, 250, 400, 648]) {
      expect(resolve(1600, 900, y)).toMatchObject({ x: 1308, y: 12, width: 280, height: 876 });
    }
  });
  it("keeps full height while a preview stays clear of the card", () => {
    expect(resolve(1344, 900, 600)).toMatchObject({ width: 280, height: 876 });
    expect(
      resolveThreadDetailsCardLayout({
        container: { width: 1600, height: 900 },
        lane,
        frame: { x: 12, y: 100, width: 320, height: 240 },
      })?.height,
    ).toBe(876);
  });
});

describe("card content fitting", () => {
  const place = (previewY: number, previewHeight = 365, overlapsDetailsCard = false) =>
    resolveThreadDetailsCardLayout({
      container: { width: 1584, height: 988 },
      lane,
      frame: { x: 1260, y: previewY, width: 240, height: previewHeight },
      overlapsDetailsCard,
    });
  it("does not fold in response to a drag while the full card can be kept clear", () => {
    for (const y of [12, 170, 225, 240, 340, 380, 611]) {
      const placement = place(y)!;
      expect(placement).toMatchObject({ x: 1292, y: 12, height: 964 });
      expect(resolveThreadDetailsCardDensity(placement.height, { full: 327, compact: 182 })).toBe(
        "full",
      );
    }
  });
  it("folds only after the preview cannot fit around the full card", () => {
    const content = { full: 327, compact: 182 };
    expect(resolveThreadDetailsCardDensity(place(351, 625, true)!.height, content)).toBe("full");
    expect(resolveThreadDetailsCardDensity(place(350, 626, true)!.height, content)).toBe("compact");
    expect(resolveThreadDetailsCardDensity(place(12)!.height, content)).toBe("full");
  });
  it("hides only when the available height cannot hold readable controls", () => {
    expect(place(184, 792, true)).toMatchObject({ y: 12, height: 160 });
    expect(place(183, 793, true)).toBeNull();
  });
  it("keeps all content as a freely moved preview approaches without colliding", () => {
    const content = { full: 162, compact: 126 };
    for (const y of [650, 450, 350, 250]) {
      expect(resolveThreadDetailsCardDensity(resolve(1600, 900, y)!.height, content)).toBe("full");
    }
  });
  it("folds only detail that cannot fit and restores it when space returns", () => {
    const content = { full: 570, compact: 180 };
    expect(resolveThreadDetailsCardDensity(600, content)).toBe("full");
    expect(resolveThreadDetailsCardDensity(400, content)).toBe("compact");
    expect(resolveThreadDetailsCardDensity(170, content)).toBe("essential");
    expect(resolveThreadDetailsCardDensity(570, content)).toBe("full");
  });
  it("shows only essentials while the user keeps it minimized, whatever the room", () => {
    const content = { full: 570, compact: 180 };
    expect(resolveThreadDetailsCardDensity(900, content, true)).toBe("essential");
    expect(resolveThreadDetailsCardDensity(900, { full: 0, compact: 0 }, true)).toBe("essential");
    expect(resolveThreadDetailsCardDensity(900, content, false)).toBe("full");
  });
  it("measures unseen content before deciding to fold it", () => {
    expect(resolveThreadDetailsCardDensity(300, { full: 0, compact: 0 })).toBe("full");
    expect(resolveThreadDetailsCardDensity(300, { full: 570, compact: 0 })).toBe("compact");
  });
});
