import { describe, expect, it } from "vitest";

import { parseFilesRouteSearch, stripFilesSearchParams } from "../../../filesRouteSearch";

describe("parseFilesRouteSearch", () => {
  it("parses a valid file param", () => {
    const parsed = parseFilesRouteSearch({ file: "src/app.ts" });

    expect(parsed).toEqual({ file: "src/app.ts" });
  });

  it("returns undefined for an empty string", () => {
    const parsed = parseFilesRouteSearch({ file: "" });

    expect(parsed).toEqual({ file: undefined });
  });

  it("returns undefined when no file param is present", () => {
    const parsed = parseFilesRouteSearch({});

    expect(parsed).toEqual({ file: undefined });
  });

  it("returns undefined for a non-string file value", () => {
    expect(parseFilesRouteSearch({ file: 42 })).toEqual({ file: undefined });
    expect(parseFilesRouteSearch({ file: true })).toEqual({ file: undefined });
    expect(parseFilesRouteSearch({ file: null })).toEqual({ file: undefined });
    expect(parseFilesRouteSearch({ file: ["a"] })).toEqual({ file: undefined });
  });
});

describe("stripFilesSearchParams", () => {
  it("removes file and keeps other params", () => {
    const result = stripFilesSearchParams({
      file: "src/app.ts",
      diff: "1",
      other: "value",
    });

    expect(result).toEqual({ diff: "1", other: "value" });
    expect(result).not.toHaveProperty("file");
  });
});
