import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

// The viewer's help text is a dialog description; outside a dialog it is just a paragraph.
vi.mock("../ui/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/dialog")>();
  return {
    ...actual,
    DialogDescription: (props: { id?: string; className?: string; children?: unknown }) => (
      <p id={props.id} className={props.className}>
        {props.children as never}
      </p>
    ),
  };
});
vi.mock("@t3tools/client-runtime/mermaid-renderer", () => ({
  renderMermaid: vi.fn(
    async (_source: string, theme: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${theme}</text></svg>`,
  ),
}));

import { ExpandedDiagram } from "./MermaidDiagram";

const darkSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>dark</text></svg>';

function canvasOf(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ "aria-label": "Diagram canvas" });
}

function toggleOf(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.type === "button" &&
      String(node.props["aria-label"] ?? "").startsWith("Switch diagram to"),
  )[0]!;
}

describe("ExpandedDiagram", () => {
  it("opens in the app theme and re-renders the source in the other palette on toggle", async () => {
    const { renderMermaid } = await import("@t3tools/client-runtime/mermaid-renderer");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<ExpandedDiagram source="graph TD; A-->B" theme="dark" svg={darkSvg} />);
      });
      expect(canvasOf(renderer!).props["data-diagram-theme"]).toBe("dark");
      expect(canvasOf(renderer!).props.style.backgroundColor).toBe("#18181b");
      // The app's render is reused; nothing is re-rendered just to open the viewer.
      expect(vi.mocked(renderMermaid)).not.toHaveBeenCalled();

      await act(async () => {
        toggleOf(renderer!).props.onClick();
      });
      expect(vi.mocked(renderMermaid)).toHaveBeenCalledWith("graph TD; A-->B", "light");
      expect(canvasOf(renderer!).props["data-diagram-theme"]).toBe("light");
      expect(canvasOf(renderer!).props.style.backgroundColor).toBe("#ffffff");
      const image = renderer!.root.findByProps({ alt: "Mermaid diagram" });
      expect(decodeURIComponent(String(image.props.src))).toContain("<text>light</text>");
      expect(toggleOf(renderer!).props["aria-label"]).toBe("Switch diagram to dark");

      // Back to the app theme reuses the original picture without another render.
      await act(async () => {
        toggleOf(renderer!).props.onClick();
      });
      expect(vi.mocked(renderMermaid)).toHaveBeenCalledTimes(1);
      expect(canvasOf(renderer!).props["data-diagram-theme"]).toBe("dark");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("keeps the current picture and reports when the other palette fails to render", async () => {
    const { renderMermaid } = await import("@t3tools/client-runtime/mermaid-renderer");
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("boom"));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<ExpandedDiagram source="graph TD; A-->B" theme="light" svg={darkSvg} />);
      });
      await act(async () => {
        toggleOf(renderer!).props.onClick();
      });
      expect(canvasOf(renderer!).props["data-diagram-theme"]).toBe("light");
      expect(JSON.stringify(renderer!.toJSON())).toContain("dark version could not be rendered");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
