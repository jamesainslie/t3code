import { describe, expect, it } from "vitest";
import { getRetryConfig } from "../connectionErrorClassifier";

describe("getRetryConfig", () => {
  it("returns 3 attempts for tunnel-closed", () => {
    const config = getRetryConfig("tunnel-closed");
    expect(config).toEqual({ maxAttempts: 3, delaysMs: [2000, 4000, 8000] });
  });

  it("returns 2 attempts for server-unreachable", () => {
    const config = getRetryConfig("server-unreachable");
    expect(config).toEqual({ maxAttempts: 2, delaysMs: [5000, 10000] });
  });

  it("returns 2 attempts for network-error", () => {
    const config = getRetryConfig("network-error");
    expect(config).toEqual({ maxAttempts: 2, delaysMs: [5000, 10000] });
  });

  it("returns null for auth-expired (no retry)", () => {
    const config = getRetryConfig("auth-expired");
    expect(config).toBeNull();
  });
});
