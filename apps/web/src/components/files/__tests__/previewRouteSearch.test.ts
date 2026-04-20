import { describe, expect, it } from "vitest";

import {
  closePreviewRouteSearch,
  parsePreviewRouteSearch,
  stripPreviewSearchParams,
} from "../../../previewRouteSearch";

describe("parsePreviewRouteSearch", () => {
  it("parses a valid preview param", () => {
    const parsed = parsePreviewRouteSearch({ preview: "docs/README.md" });

    expect(parsed).toEqual({ preview: "docs/README.md" });
  });

  it("returns undefined for an empty string", () => {
    const parsed = parsePreviewRouteSearch({ preview: "" });

    expect(parsed).toEqual({ preview: undefined });
  });

  it("returns undefined when no preview param is present", () => {
    const parsed = parsePreviewRouteSearch({});

    expect(parsed).toEqual({ preview: undefined });
  });

  it("returns undefined for a non-string preview value", () => {
    expect(parsePreviewRouteSearch({ preview: 42 })).toEqual({ preview: undefined });
    expect(parsePreviewRouteSearch({ preview: true })).toEqual({ preview: undefined });
    expect(parsePreviewRouteSearch({ preview: null })).toEqual({ preview: undefined });
    expect(parsePreviewRouteSearch({ preview: ["a"] })).toEqual({ preview: undefined });
  });
});

describe("stripPreviewSearchParams", () => {
  it("removes preview and keeps other params", () => {
    const result = stripPreviewSearchParams({
      preview: "docs/README.md",
      diff: "1",
      other: "value",
    });

    expect(result).toEqual({ diff: "1", other: "value" });
    expect(result).not.toHaveProperty("preview");
  });

  it("handles absence of preview param gracefully", () => {
    const result = stripPreviewSearchParams({
      diff: "1",
    });

    expect(result).toEqual({ diff: "1" });
  });
});

describe("closePreviewRouteSearch", () => {
  it("explicitly clears preview so retained search middleware does not restore it", () => {
    const result = closePreviewRouteSearch({
      preview: "docs/README.md",
      diff: "1",
      other: "value",
    });

    expect(result).toEqual({ diff: "1", other: "value", preview: undefined });
    expect(result).toHaveProperty("preview", undefined);
  });
});
