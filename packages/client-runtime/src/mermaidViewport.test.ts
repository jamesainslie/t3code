import { describe, expect, it } from "vite-plus/test";
import { fitDiagram, zoomDiagram } from "./mermaidViewport.ts";

describe("diagram viewport", () => {
  it("fits very large diagrams without a minimum zoom hiding content", () => {
    expect(fitDiagram({ width: 400, height: 300 }, { width: 10000, height: 2000 })).toEqual({
      x: 0,
      y: 0,
      scale: 0.0352,
    });
  });
  it("keeps the point under the pointer stationary when zooming", () => {
    expect(zoomDiagram({ x: 20, y: -10, scale: 1 }, 2, { x: 100, y: 50 })).toEqual({
      x: -60,
      y: -70,
      scale: 2,
    });
  });
  it("limits zoom without jumping at the limit", () => {
    const view = { x: 12, y: 34, scale: 8 };
    expect(zoomDiagram(view, 2, { x: 100, y: 100 })).toEqual(view);
  });
});
