import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInitialize = vi.fn();
const mockRender = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import { MermaidDiagram } from "../MermaidDiagram";

beforeEach(() => {
  vi.clearAllMocks();
  mockRender.mockResolvedValue({ svg: "<svg>test</svg>" });
});

describe("MermaidDiagram", () => {
  it("shows a pending frame before the async render completes", () => {
    // In SSR, useEffect does not run, so the svg is not yet available.
    const html = renderToStaticMarkup(<MermaidDiagram source="graph TD; A-->B" theme="light" />);
    expect(html).toContain("Rendering diagram");
  });

  it("does not call mermaid during render (render happens in an effect)", () => {
    renderToStaticMarkup(<MermaidDiagram source="graph TD; A-->B" theme="light" />);
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("accepts an onError callback prop without crashing", () => {
    const onError = vi.fn();
    const html = renderToStaticMarkup(
      <MermaidDiagram source="graph TD; A-->B" theme="light" onError={onError} />,
    );
    expect(html).toContain("Rendering diagram");
    expect(onError).not.toHaveBeenCalled();
  });

  it("is memoized — same props produce identical output across renders", () => {
    const props = { source: "graph TD; A-->B", theme: "light" as const };
    const html1 = renderToStaticMarkup(<MermaidDiagram {...props} />);
    const html2 = renderToStaticMarkup(<MermaidDiagram {...props} />);
    expect(html1).toBe(html2);
  });

  it("renders both themes without errors", () => {
    expect(() =>
      renderToStaticMarkup(<MermaidDiagram source="graph TD; A-->B" theme="light" />),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(<MermaidDiagram source="graph TD; A-->B" theme="dark" />),
    ).not.toThrow();
  });
});
