import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampScale,
  fitScale,
  initialZoomState,
  panBy,
  zoomAtPoint,
} from "../mermaidZoom.logic";

describe("clampScale", () => {
  it("passes through values inside the range", () => {
    expect(clampScale(1)).toBe(1);
  });

  it("clamps below the minimum", () => {
    expect(clampScale(0)).toBe(MIN_ZOOM);
  });

  it("clamps above the maximum", () => {
    expect(clampScale(100)).toBe(MAX_ZOOM);
  });
});

describe("initialZoomState", () => {
  it("starts unscaled and untranslated", () => {
    expect(initialZoomState()).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("panBy", () => {
  it("translates by the given delta", () => {
    expect(panBy({ scale: 2, x: 10, y: -5 }, 3, 4)).toEqual({ scale: 2, x: 13, y: -1 });
  });
});

describe("zoomAtPoint", () => {
  it("keeps the anchor point stationary while zooming in", () => {
    const state = { scale: 1, x: 0, y: 0 };
    const next = zoomAtPoint(state, 2, 100, 50);
    // Content point under (100, 50) was (100, 50); after scaling by 2 the
    // translation must shift so that same content point stays under the cursor.
    expect(next.scale).toBe(2);
    expect(next.x).toBe(100 - 100 * 2);
    expect(next.y).toBe(50 - 50 * 2);
  });

  it("is reversible: zooming in then out at the same point restores the state", () => {
    const state = { scale: 1, x: 20, y: 30 };
    const zoomedIn = zoomAtPoint(state, 2, 80, 60);
    const restored = zoomAtPoint(zoomedIn, 0.5, 80, 60);
    expect(restored.scale).toBeCloseTo(1);
    expect(restored.x).toBeCloseTo(20);
    expect(restored.y).toBeCloseTo(30);
  });

  it("clamps the resulting scale", () => {
    const state = { scale: MAX_ZOOM, x: 0, y: 0 };
    const next = zoomAtPoint(state, 10, 0, 0);
    expect(next.scale).toBe(MAX_ZOOM);
    // No scale change means no translation change either.
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });
});

describe("fitScale", () => {
  it("scales down large content to fit the viewport with padding", () => {
    // 2000x1000 content into a 1000x800 viewport with 50px padding on each side:
    // width ratio 900/2000 = 0.45, height ratio 700/1000 = 0.7 -> 0.45.
    expect(fitScale(2000, 1000, 1000, 800, 50)).toBeCloseTo(0.45);
  });

  it("scales up small content, bounded by the max zoom", () => {
    const scale = fitScale(10, 10, 1000, 1000, 0);
    expect(scale).toBe(MAX_ZOOM);
  });

  it("never returns below the minimum zoom", () => {
    expect(fitScale(100000, 100000, 100, 100, 0)).toBe(MIN_ZOOM);
  });

  it("treats degenerate content dimensions as unscaled", () => {
    expect(fitScale(0, 0, 1000, 1000, 0)).toBe(1);
  });
});
