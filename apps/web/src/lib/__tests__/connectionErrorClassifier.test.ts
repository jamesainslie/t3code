import { describe, expect, it } from "vitest";
import {
  classifyConnectionError,
  type ConnectionErrorCategory,
} from "../connectionErrorClassifier";

describe("classifyConnectionError", () => {
  it("classifies fetch TypeError on SSH env as tunnel-closed", () => {
    const result = classifyConnectionError(
      new TypeError("Failed to fetch"),
      { isSsh: true },
    );
    expect(result.category).toBe("tunnel-closed");
    expect(result.headline).toBe("Connection lost");
    expect(result.guidance).toMatch(/SSH tunnel/);
  });

  it("classifies fetch TypeError on non-SSH env as server-unreachable", () => {
    const result = classifyConnectionError(
      new TypeError("Failed to fetch"),
      { isSsh: false },
    );
    expect(result.category).toBe("server-unreachable");
    expect(result.headline).toBe("Server unreachable");
  });

  it("classifies HTTP 401 as auth-expired", () => {
    const error = Object.assign(new Error("Remote auth request failed (401)."), {
      statusCode: 401,
    });
    const result = classifyConnectionError(error, { isSsh: true });
    expect(result.category).toBe("auth-expired");
    expect(result.headline).toBe("Session expired");
    expect(result.guidance).toMatch(/Re-pair/);
  });

  it("classifies HTTP 403 as auth-expired", () => {
    const error = Object.assign(new Error("Forbidden"), { statusCode: 403 });
    const result = classifyConnectionError(error, { isSsh: false });
    expect(result.category).toBe("auth-expired");
  });

  it("classifies HTTP 502 as server-unreachable", () => {
    const error = Object.assign(new Error("Bad Gateway"), { statusCode: 502 });
    const result = classifyConnectionError(error, { isSsh: false });
    expect(result.category).toBe("server-unreachable");
  });

  it("classifies HTTP 503 as server-unreachable", () => {
    const error = Object.assign(new Error("Service Unavailable"), {
      statusCode: 503,
    });
    const result = classifyConnectionError(error, { isSsh: true });
    expect(result.category).toBe("server-unreachable");
  });

  it("classifies HTTP 504 as server-unreachable", () => {
    const error = Object.assign(new Error("Gateway Timeout"), {
      statusCode: 504,
    });
    const result = classifyConnectionError(error, { isSsh: false });
    expect(result.category).toBe("server-unreachable");
  });

  it("classifies DNS/timeout errors as network-error", () => {
    const result = classifyConnectionError(
      new TypeError("net::ERR_NAME_NOT_RESOLVED"),
      { isSsh: false },
    );
    expect(result.category).toBe("network-error");
    expect(result.headline).toBe("Network error");
    expect(result.guidance).toMatch(/online/);
  });

  it("classifies unknown errors as network-error fallback", () => {
    const result = classifyConnectionError(
      new Error("Something unexpected"),
      { isSsh: false },
    );
    expect(result.category).toBe("network-error");
  });

  it("handles string errors", () => {
    const result = classifyConnectionError("connection refused", {
      isSsh: false,
    });
    expect(result.category).toBe("network-error");
  });

  it("classifies 'Failed to fetch remote auth endpoint' wrapper as tunnel-closed for SSH", () => {
    const cause = new TypeError("Failed to fetch");
    const wrapper = new Error(
      "Failed to fetch remote auth endpoint http://127.0.0.1:60050/api/auth/session (Failed to fetch).",
      { cause },
    );
    const result = classifyConnectionError(wrapper, { isSsh: true });
    expect(result.category).toBe("tunnel-closed");
  });
});
