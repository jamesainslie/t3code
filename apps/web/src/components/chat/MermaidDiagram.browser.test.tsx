import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const { renderMermaid } = vi.hoisted(() => ({
  renderMermaid: vi.fn(
    async (_source: string, theme: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${theme}</text></svg>`,
  ),
}));
vi.mock(import("@lathe/client-runtime/mermaid-renderer"), async (original) => ({
  ...(await original()),
  renderMermaid,
}));

import { ExpandedDiagram } from "./MermaidDiagram";

const darkSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>dark</text></svg>';
const canvas = () => page.getByRole("region", { name: "Diagram canvas" });
const diagramSource = () =>
  decodeURIComponent(
    page.getByRole("img", { name: "Mermaid diagram" }).element().getAttribute("src") ?? "",
  );

describe("ExpandedDiagram", () => {
  it("opens in the app theme and re-renders the source in the other palette on toggle", async () => {
    renderMermaid.mockClear();
    await using _screen = await render(
      <ExpandedDiagram source="graph TD; A-->B" theme="dark" svg={darkSvg} />,
    );

    await expect.element(canvas()).toHaveAttribute("data-diagram-theme", "dark");
    await expect.element(canvas()).toHaveStyle({ backgroundColor: "rgb(24, 24, 27)" });
    // The app's render is reused; nothing is re-rendered just to open the viewer.
    expect(renderMermaid).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Switch diagram to light" }).click();
    await expect.element(canvas()).toHaveAttribute("data-diagram-theme", "light");
    await expect.element(canvas()).toHaveStyle({ backgroundColor: "rgb(255, 255, 255)" });
    expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", "light");
    expect(diagramSource()).toContain("<text>light</text>");

    // Back to the app theme reuses the original picture without another render.
    await page.getByRole("button", { name: "Switch diagram to dark" }).click();
    await expect.element(canvas()).toHaveAttribute("data-diagram-theme", "dark");
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    expect(diagramSource()).toContain("<text>dark</text>");
  });

  it("keeps the current picture and reports when the other palette fails to render", async () => {
    renderMermaid.mockClear().mockRejectedValueOnce(new Error("boom"));
    await using _screen = await render(
      <ExpandedDiagram source="graph TD; A-->B" theme="light" svg={darkSvg} />,
    );

    await page.getByRole("button", { name: "Switch diagram to dark" }).click();

    await expect
      .element(page.getByText("The dark version could not be rendered."))
      .toBeInTheDocument();
    await expect.element(canvas()).toHaveAttribute("data-diagram-theme", "light");
  });
});
