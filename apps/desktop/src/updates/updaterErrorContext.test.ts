import { describe, expect, it } from "vite-plus/test";

import { updaterErrorContext } from "./updaterErrorContext.ts";

describe("updaterErrorContext", () => {
  it("keeps the status line of an HTTP failure and drops the response body", () => {
    const cause = Object.assign(
      new Error('502 Bad Gateway\n"<!DOCTYPE html><title>Unicorn! &middot; GitHub</title>"'),
      { name: "HttpError", statusCode: 502 },
    );
    expect(updaterErrorContext(cause)).toEqual({
      causeName: "HttpError",
      causeSummary: "502 Bad Gateway",
      httpStatus: 502,
    });
  });

  it("reduces URLs to their origin and path so credentials and queries never reach the log", () => {
    const cause = new Error(
      "request failed for https://user:secret@example.com/update/latest.yml?token=secret#frag",
    );
    const context = updaterErrorContext(cause);
    expect(context.causeSummary).toBe("request failed for https://example.com/update/latest.yml");
    expect(JSON.stringify(context)).not.toContain("secret");
  });

  it("masks token-like strings and bounds the summary", () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd";
    const context = updaterErrorContext(new Error(`auth ${token} ${"x".repeat(400)}`));
    expect(context.causeSummary).not.toContain(token);
    expect(context.causeSummary?.startsWith("auth [redacted]")).toBe(true);
    expect(context.causeSummary?.length).toBeLessThanOrEqual(200);
  });

  it("keeps a network error code", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), {
      code: "ENOTFOUND",
    });
    expect(updaterErrorContext(cause)).toEqual({
      causeName: "Error",
      causeSummary: "getaddrinfo ENOTFOUND github.com",
      causeCode: "ENOTFOUND",
    });
  });

  it("describes a cause that is not an Error by its type only", () => {
    expect(updaterErrorContext("https://user:secret@example.com")).toEqual({
      causeName: "string",
    });
    expect(updaterErrorContext(undefined)).toEqual({ causeName: "undefined" });
  });
});
