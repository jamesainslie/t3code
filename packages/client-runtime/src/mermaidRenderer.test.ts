import { describe, expect, it, vi } from "vite-plus/test";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

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
