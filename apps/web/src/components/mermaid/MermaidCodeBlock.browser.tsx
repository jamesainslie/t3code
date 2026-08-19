import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { readLocalApiMock } = vi.hoisted(() => ({
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: [] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import ChatMarkdown from "../ChatMarkdown";

const VALID_DIAGRAM = "graph LR\n  a[Start] --> b[End]\n";
const VALID_TEXT = `Intro\n\n\`\`\`mermaid\n${VALID_DIAGRAM}\`\`\`\n`;
const INVALID_TEXT = "```mermaid\nthis is not a valid diagram %%%\n```\n";

function diagramSvg(): SVGSVGElement | null {
  // Lucide toolbar icons are also svg elements, and mermaid parks a temporary
  // work element directly under document.body while rendering — the finished
  // diagram is the svg with mermaid's render id inside the code block.
  return document.querySelector('.chat-markdown-codeblock svg[id^="mermaid-diagram-"]');
}

describe("MermaidCodeBlock (browser)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a valid mermaid fence as an svg diagram", async () => {
    const screen = await render(<ChatMarkdown text={VALID_TEXT} cwd="/repo" />);
    try {
      await vi.waitFor(
        () => {
          expect(diagramSvg()).not.toBeNull();
          // Diagram nodes carry their labels inside the svg.
          expect(document.body.textContent).toContain("Start");
        },
        { timeout: 15_000 },
      );
    } finally {
      await screen.unmount();
    }
  });

  it("falls back to highlighted source with an error notice for invalid diagrams", async () => {
    const screen = await render(<ChatMarkdown text={INVALID_TEXT} cwd="/repo" />);
    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("Diagram failed to render");
        },
        { timeout: 15_000 },
      );
      expect(diagramSvg()).toBeNull();
      const preview = page.getByRole("button", { name: "Preview" });
      await expect.element(preview).toBeDisabled();
    } finally {
      await screen.unmount();
    }
  });

  it("does not attempt to render a still-streaming fence until it settles", async () => {
    const openFence = "```mermaid\ngraph LR\n  a[Start] -->";
    const screen = await render(<ChatMarkdown text={openFence} cwd="/repo" isStreaming />);
    try {
      // While tokens are arriving the block must show source, not a diagram.
      expect(diagramSvg()).toBeNull();
      await screen.rerender(
        <ChatMarkdown text={`${openFence} b[End]\n`} cwd="/repo" isStreaming />,
      );
      expect(diagramSvg()).toBeNull();

      // Stream completes: the fence closes and the diagram renders.
      await screen.rerender(<ChatMarkdown text={VALID_TEXT} cwd="/repo" isStreaming={false} />);
      await vi.waitFor(
        () => {
          expect(diagramSvg()).not.toBeNull();
        },
        { timeout: 15_000 },
      );
    } finally {
      await screen.unmount();
    }
  });

  it("expands the diagram into a zoomable overlay and closes it again", async () => {
    const screen = await render(<ChatMarkdown text={VALID_TEXT} cwd="/repo" />);
    try {
      await vi.waitFor(
        () => {
          expect(diagramSvg()).not.toBeNull();
        },
        { timeout: 15_000 },
      );

      // Toolbar buttons are revealed on codeblock hover (opacity/pointer-events
      // gated in index.css), so hover the diagram before clicking.
      const svgElement = diagramSvg();
      expect(svgElement).not.toBeNull();
      await page.elementLocator(svgElement as Element).hover();
      await page.getByRole("button", { name: "Expand diagram" }).click();
      const dialog = page.getByRole("dialog", { name: "Diagram viewer" });
      await expect.element(dialog).toBeInTheDocument();

      await page.getByRole("button", { name: "Close diagram viewer" }).click();
      await vi.waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });
});
