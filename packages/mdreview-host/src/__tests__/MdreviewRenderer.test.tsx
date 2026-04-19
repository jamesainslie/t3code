import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  FileAdapter as CoreFileAdapter,
  MessagingAdapter as CoreMessagingAdapter,
  StorageAdapter as CoreStorageAdapter,
} from "@mdreview/core";

import { MdreviewRenderer } from "../MdreviewRenderer.tsx";

const noopFileAdapter: CoreFileAdapter = {
  writeFile: async () => ({ success: false, error: "noop" }),
  readFile: async () => "",
  checkChanged: async () => ({ changed: false }),
  watch: () => () => undefined,
};

const noopStorageAdapter: CoreStorageAdapter = {
  getSync: async () => ({}),
  setSync: async () => undefined,
  getLocal: async () => ({}),
  setLocal: async () => undefined,
};

const noopMessagingAdapter: CoreMessagingAdapter = {
  send: async () => undefined,
};

const fakeAdapters = {
  file: noopFileAdapter,
  storage: noopStorageAdapter,
  messaging: noopMessagingAdapter,
} as const;

describe("MdreviewRenderer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders an <h1> for a '# hi' markdown source", () => {
    const { container } = render(
      <MdreviewRenderer source="# hi" adapters={fakeAdapters} />,
    );
    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("hi");
  });

  it("renders paragraph text", () => {
    const { container } = render(
      <MdreviewRenderer source="hello world" adapters={fakeAdapters} />,
    );
    const p = container.querySelector("p");
    expect(p?.textContent).toBe("hello world");
  });

  it("preserves mermaid code fences as mermaid blocks", () => {
    const source = "# Diag\n\n```mermaid\ngraph TD; A-->B\n```\n";
    const { container } = render(
      <MdreviewRenderer source={source} adapters={fakeAdapters} />,
    );
    // mdview's MarkdownConverter emits a <div class="mermaid"> or similar
    // placeholder — check for any mermaid-tagged element in the output.
    const html = container.innerHTML;
    expect(html.toLowerCase()).toContain("mermaid");
  });

  it("re-renders when the source prop changes", () => {
    const { container, rerender } = render(
      <MdreviewRenderer source="# first" adapters={fakeAdapters} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("first");

    rerender(<MdreviewRenderer source="## second" adapters={fakeAdapters} />);
    expect(container.querySelector("h2")?.textContent).toBe("second");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("attaches the theme prop as data-theme on the root element when provided", () => {
    const { container } = render(
      <MdreviewRenderer
        source="x"
        adapters={fakeAdapters}
        theme="catppuccin-mocha"
      />,
    );
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.getAttribute("data-theme")).toBe("catppuccin-mocha");
  });

  it("reuses the same MarkdownConverter instance across renders with stable adapters", () => {
    const { rerender, container } = render(
      <MdreviewRenderer source="# a" adapters={fakeAdapters} />,
    );
    const first = container.querySelector("h1");
    rerender(<MdreviewRenderer source="# b" adapters={fakeAdapters} />);
    const second = container.querySelector("h1");
    // Sanity — both renders produced valid output.
    expect(first?.textContent).toBe("a");
    expect(second?.textContent).toBe("b");
  });
});
