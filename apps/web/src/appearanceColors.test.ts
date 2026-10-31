import { describe, expect, it } from "vite-plus/test";

import { applyAppearanceColorOverrides, resolveColorPreference } from "./appearanceColors";

// The unit project has no DOM; a minimal root records the same surface the
// real element exposes (inline custom properties and the dataset).
function makeRoot() {
  const properties = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const root = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    dataset,
  } as unknown as HTMLElement;
  return { root, properties, dataset };
}

describe("resolveColorPreference", () => {
  it("accepts hex colors and trims whitespace", () => {
    expect(resolveColorPreference("#d4d4d8")).toBe("#d4d4d8");
    expect(resolveColorPreference("  #fff ")).toBe("#fff");
  });

  it("treats empty or unparsable input as unset", () => {
    expect(resolveColorPreference("")).toBeNull();
    expect(resolveColorPreference("   ")).toBeNull();
    expect(resolveColorPreference("not a color")).toBeNull();
    expect(resolveColorPreference("#12")).toBeNull();
  });
});

describe("applyAppearanceColorOverrides", () => {
  it("sets a variable and flag per valid override and clears the rest", () => {
    const { root, properties, dataset } = makeRoot();
    applyAppearanceColorOverrides(root, {
      chatText: "#d4d4d8",
      markdownPreviewText: "",
      terminalText: "#a1a1aa",
      composerCaret: "",
      threadCard: "garbage",
    });
    expect(properties.get("--user-chat-text")).toBe("#d4d4d8");
    expect(dataset.userChatText).toBe("");
    expect(properties.has("--user-markdown-preview-text")).toBe(false);
    expect("userMarkdownPreviewText" in dataset).toBe(false);
    expect(properties.get("--user-terminal-text")).toBe("#a1a1aa");
    expect(dataset.userTerminalText).toBe("");
    expect(properties.has("--user-composer-caret")).toBe(false);
    expect("userComposerCaret" in dataset).toBe(false);
    expect(properties.has("--user-thread-card")).toBe(false);
    expect("userThreadCard" in dataset).toBe(false);
  });

  it("removes a previously applied override when it is reset", () => {
    const { root, properties, dataset } = makeRoot();
    applyAppearanceColorOverrides(root, {
      chatText: "#d4d4d8",
      markdownPreviewText: "#c4c4c8",
      terminalText: "#a1a1aa",
      composerCaret: "#ff9900",
      threadCard: "#18181b",
    });
    expect(properties.size).toBe(5);
    applyAppearanceColorOverrides(root, {
      chatText: "",
      markdownPreviewText: "",
      terminalText: "",
      composerCaret: "",
      threadCard: "",
    });
    expect(properties.size).toBe(0);
    expect(Object.keys(dataset)).toEqual([]);
  });
});
