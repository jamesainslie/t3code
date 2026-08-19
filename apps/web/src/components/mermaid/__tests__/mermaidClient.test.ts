import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInitialize = vi.fn();
const mockRender = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

import { renderMermaidDiagram, resetMermaidInitializationForTests } from "../mermaidClient";

beforeEach(() => {
  vi.clearAllMocks();
  resetMermaidInitializationForTests();
  mockRender.mockResolvedValue({ svg: "<svg>ok</svg>" });
});

describe("renderMermaidDiagram", () => {
  it("initializes mermaid before rendering", async () => {
    await renderMermaidDiagram("id-1", "graph TD; A-->B", "light");
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledWith("id-1", "graph TD; A-->B");
  });

  it("initializes with strict security and no autostart", async () => {
    await renderMermaidDiagram("id-1", "graph TD; A-->B", "light");
    expect(mockInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: "default",
      }),
    );
  });

  it("initializes only once for repeated renders on the same theme", async () => {
    await renderMermaidDiagram("id-1", "graph TD; A-->B", "dark");
    await renderMermaidDiagram("id-2", "graph LR; C-->D", "dark");
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("re-initializes when the theme changes", async () => {
    await renderMermaidDiagram("id-1", "graph TD; A-->B", "light");
    await renderMermaidDiagram("id-2", "graph TD; A-->B", "dark");
    expect(mockInitialize).toHaveBeenCalledTimes(2);
    expect(mockInitialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("resolves with the rendered svg string", async () => {
    await expect(renderMermaidDiagram("id-1", "graph TD; A-->B", "light")).resolves.toBe(
      "<svg>ok</svg>",
    );
  });

  it("propagates render failures", async () => {
    mockRender.mockRejectedValue(new Error("Parse error on line 2"));
    await expect(renderMermaidDiagram("id-1", "not a diagram", "light")).rejects.toThrow(
      "Parse error on line 2",
    );
  });
});
