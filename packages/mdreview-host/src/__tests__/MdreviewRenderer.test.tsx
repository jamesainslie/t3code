import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FileAdapter as CoreFileAdapter,
  MessagingAdapter as CoreMessagingAdapter,
  Preferences,
  StorageAdapter as CoreStorageAdapter,
} from "@mdreview/core";
import { DEFAULT_PREFERENCES } from "@mdreview/core";

import { MdreviewRenderer } from "../MdreviewRenderer.tsx";

const mockMermaidRenderer = vi.hoisted(() => ({
  renderAllImmediate: vi.fn(async (container: HTMLElement) => {
    for (const diagram of container.querySelectorAll<HTMLElement>(".mermaid-container")) {
      diagram.classList.remove("mermaid-pending");
      diagram.classList.add("mermaid-ready");
      diagram.innerHTML = '<svg role="img"><text>diagram</text></svg>';
    }
  }),
  updateTheme: vi.fn(),
}));

vi.mock("@mdreview/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mdreview/core")>();
  return {
    ...actual,
    mermaidRenderer: mockMermaidRenderer,
  };
});

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

function makeAdaptersWithPreferences(preferences: Partial<Preferences>) {
  return {
    ...fakeAdapters,
    storage: {
      ...noopStorageAdapter,
      getSync: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        return keyList.includes("preferences")
          ? { preferences: { ...DEFAULT_PREFERENCES, ...preferences } }
          : {};
      },
    },
  };
}

function getShadowRoot(container: HTMLElement): ShadowRoot {
  const host = container.querySelector<HTMLElement>(".mdreview-host-root");
  expect(host).not.toBeNull();
  if (!host) {
    throw new Error("expected mdreview host");
  }
  expect(host.shadowRoot).not.toBeNull();
  if (!host.shadowRoot) {
    throw new Error("expected mdreview shadow root");
  }
  return host.shadowRoot;
}

describe("MdreviewRenderer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders an <h1> for a '# hi' markdown source", async () => {
    const { container } = render(<MdreviewRenderer source="# hi" adapters={fakeAdapters} />);
    await waitFor(() => {
      const heading = getShadowRoot(container).querySelector("h1");
      expect(heading).not.toBeNull();
      expect(heading?.textContent).toBe("hi");
    });
  });

  it("renders paragraph text", async () => {
    const { container } = render(<MdreviewRenderer source="hello world" adapters={fakeAdapters} />);
    await waitFor(() => {
      const p = getShadowRoot(container).querySelector("p");
      expect(p?.textContent).toBe("hello world");
    });
  });

  it("creates an isolated mdreview document with content styles", () => {
    const { container } = render(<MdreviewRenderer source="# hi" adapters={fakeAdapters} />);
    const shadowRoot = getShadowRoot(container);

    expect(shadowRoot.querySelector("style")?.textContent).toContain(
      ".mdreview-shadow-document.mdreview-active",
    );
    expect(shadowRoot.querySelector(".mdreview-shadow-document.mdreview-active")).not.toBeNull();
    expect(shadowRoot.querySelector("#mdreview-container.mdreview-rendered")).not.toBeNull();
  });

  it("preserves mermaid code fences as mermaid blocks", async () => {
    const source = "# Diag\n\n```mermaid\ngraph TD; A-->B\n```\n";
    const { container } = render(<MdreviewRenderer source={source} adapters={fakeAdapters} />);
    // mdview's MarkdownConverter emits a <div class="mermaid"> or similar
    // placeholder — check for any mermaid-tagged element in the output.
    await waitFor(() => {
      const html = getShadowRoot(container).innerHTML;
      expect(html.toLowerCase()).toContain("mermaid");
    });
  });

  it("hydrates mermaid placeholders through MD Review's MermaidRenderer", async () => {
    const source = "# Diag\n\n```mermaid\ngraph TD; A-->B\n```\n";
    render(<MdreviewRenderer source={source} adapters={fakeAdapters} filePath="docs/diag.md" />);

    await waitFor(() => {
      expect(mockMermaidRenderer.renderAllImmediate).toHaveBeenCalled();
      expect(document.querySelector(".mermaid-container svg")).not.toBeNull();
      expect(document.querySelector(".mermaid-loading")).toBeNull();
    });
  });

  it("applies stored MD Review rendering preferences", async () => {
    const adapters = makeAdaptersWithPreferences({
      autoTheme: false,
      lineNumbers: true,
      theme: "monokai-pro",
    });
    const source = "```ts\nconst answer = 42;\nconsole.log(answer);\n```";

    render(<MdreviewRenderer source={source} adapters={adapters} filePath="docs/code.md" />);

    await waitFor(() => {
      expect(document.querySelector(".code-block-wrapper.has-line-numbers")).not.toBeNull();
      expect(document.querySelector(".line-numbers-rows")?.textContent).toContain("1");
      expect(document.querySelector(".mdreview-shadow-document")?.getAttribute("data-theme")).toBe(
        "monokai-pro",
      );
    });
  });

  it("re-renders when the source prop changes", async () => {
    const { container, rerender } = render(
      <MdreviewRenderer source="# first" adapters={fakeAdapters} />,
    );
    await waitFor(() => {
      expect(getShadowRoot(container).querySelector("h1")?.textContent).toBe("first");
    });

    rerender(<MdreviewRenderer source="## second" adapters={fakeAdapters} />);
    await waitFor(() => {
      expect(getShadowRoot(container).querySelector("h2")?.textContent).toBe("second");
      expect(getShadowRoot(container).querySelector("h1")).toBeNull();
    });
  });

  it("attaches the theme prop as data-theme on the root element when provided", () => {
    const { container } = render(
      <MdreviewRenderer source="x" adapters={fakeAdapters} theme="catppuccin-mocha" />,
    );
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.getAttribute("data-theme")).toBe("catppuccin-mocha");
  });

  it("renders updated source with stable adapters", async () => {
    const { rerender, container } = render(
      <MdreviewRenderer source="# a" adapters={fakeAdapters} />,
    );
    await waitFor(() => {
      expect(getShadowRoot(container).querySelector("h1")?.textContent).toBe("a");
    });

    rerender(<MdreviewRenderer source="# b" adapters={fakeAdapters} />);
    await waitFor(() => {
      expect(getShadowRoot(container).querySelector("h1")?.textContent).toBe("b");
    });
  });

  it("opens the MD Review comment form when selected rendered text is right-clicked", async () => {
    render(<MdreviewRenderer source="hello world" adapters={fakeAdapters} filePath="docs/a.md" />);
    const container = document.getElementById("mdreview-container");
    expect(container).not.toBeNull();
    await waitFor(() => {
      expect(container?.getAttribute("data-mdreview-comments-ready")).toBe("true");
    });
    const paragraph = container?.querySelector("p");
    expect(paragraph).not.toBeNull();
    if (!paragraph) {
      throw new Error("expected rendered paragraph");
    }

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.contextMenu(paragraph);

    await waitFor(() => {
      expect(document.querySelector(".mdreview-comment-input")).not.toBeNull();
    });
  });
});
