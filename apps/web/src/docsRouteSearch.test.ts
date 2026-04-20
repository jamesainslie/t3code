import { describe, expect, it } from "vitest";
import { parseDocsRouteSearch, stripDocsSearchParams } from "./docsRouteSearch";

describe("parseDocsRouteSearch", () => {
  it("parses valid docs search values", () => {
    const parsed = parseDocsRouteSearch({
      docs: "1",
      docsPath: "README.md",
      docsMode: "preview",
    });
    expect(parsed).toEqual({
      docs: "1",
      docsPath: "README.md",
      docsMode: "preview",
    });
  });

  it("treats numeric and boolean docs toggles as open", () => {
    expect(parseDocsRouteSearch({ docs: 1 })).toEqual({ docs: "1" });
    expect(parseDocsRouteSearch({ docs: true })).toEqual({ docs: "1" });
  });

  it("drops path and mode when docs is closed", () => {
    const parsed = parseDocsRouteSearch({
      docs: "0",
      docsPath: "README.md",
      docsMode: "preview",
    });
    expect(parsed).toEqual({});
  });

  it("defaults docsMode to undefined when invalid", () => {
    const parsed = parseDocsRouteSearch({
      docs: "1",
      docsMode: "invalid",
    });
    expect(parsed).toEqual({ docs: "1" });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDocsRouteSearch({
      docs: "1",
      docsPath: "  ",
    });
    expect(parsed).toEqual({ docs: "1" });
  });

  it("accepts browser mode", () => {
    const parsed = parseDocsRouteSearch({
      docs: "1",
      docsMode: "browser",
    });
    expect(parsed).toEqual({ docs: "1", docsMode: "browser" });
  });
});

describe("stripDocsSearchParams", () => {
  it("removes docs-related keys and preserves others", () => {
    const stripped = stripDocsSearchParams({
      docs: "1",
      docsPath: "a.md",
      docsMode: "preview",
      diff: "1",
    });
    expect(stripped).toEqual({ diff: "1" });
  });
});
