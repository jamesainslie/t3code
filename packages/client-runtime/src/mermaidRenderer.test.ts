import { describe, expect, it, vi } from "vite-plus/test";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

describe("sizeMermaidSvg", () => {
  it("replaces the percentage root size with the viewBox size", async () => {
    const { sizeMermaidSvg } = await import("./mermaidRenderer.ts");
    const svg =
      '<svg id="a" width="100%" style="max-width: 640px;" viewBox="0 0 640 320" xmlns="http://www.w3.org/2000/svg"><g/></svg>';
    expect(sizeMermaidSvg(svg)).toBe(
      '<svg width="640" height="320" id="a" style="max-width: 640px;" viewBox="0 0 640 320" xmlns="http://www.w3.org/2000/svg"><g/></svg>',
    );
  });

  it("leaves a root without a usable viewBox alone", async () => {
    const { sizeMermaidSvg } = await import("./mermaidRenderer.ts");
    expect(sizeMermaidSvg('<svg width="100%"><g/></svg>')).toBe('<svg width="100%"><g/></svg>');
    expect(sizeMermaidSvg('<svg viewBox="0 0 0 10"><g/></svg>')).toBe(
      '<svg viewBox="0 0 0 10"><g/></svg>',
    );
  });
});

describe("Mermaid rendering", () => {
  it("shares concurrent renders, separates themes and recovers after invalid source", async () => {
    const { renderMermaid } = await import("./mermaidRenderer.ts");
    mermaid.render.mockResolvedValue({ svg: '<svg viewBox="0 0 400 200"></svg>' });
    const first = renderMermaid("graph TD; A-->B", "dark");
    const second = renderMermaid("graph TD; A-->B", "dark");
    expect(await first).toEqual(await second);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    await renderMermaid("graph TD; A-->B", "light");
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    mermaid.render.mockRejectedValueOnce(new Error("Invalid diagram"));
    await expect(renderMermaid("broken", "dark")).rejects.toThrow("Invalid diagram");
    await expect(renderMermaid("sequenceDiagram", "dark")).resolves.toContain("<svg");
  });
});
