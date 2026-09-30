import { describe, expect, it } from "@effect/vitest";

import { cutToBytes } from "./text.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).length;

describe("cutToBytes", () => {
  it("cutToBytes never splits a surrogate pair", () => {
    // A budget of 3 bytes before the ellipsis lands inside the 4-byte emoji.
    const result = cutToBytes("ab😀cd", 6);
    expect(result).toBe("ab…");
    expect(Buffer.from(result).toString()).toBe(result);
    // With the ellipsis counted, 4 bytes leave room for one ASCII character.
    expect(cutToBytes("ab😀cd", 4)).toBe("a…");
  });

  it("cutToBytes leaves short text alone", () => {
    expect(cutToBytes("hello", 5)).toBe("hello");
    expect(cutToBytes("ab😀cd", 8)).toBe("ab😀cd");
    expect(cutToBytes("", 0)).toBe("");
  });

  it("cutToBytes result including the ellipsis fits maxBytes", () => {
    const text = "héllo wörld 😀 ünïcode ".repeat(20);
    for (let maxBytes = 0; maxBytes <= 64; maxBytes += 1) {
      const result = cutToBytes(text, maxBytes);
      expect(byteLength(result)).toBeLessThanOrEqual(maxBytes);
      expect(result).not.toContain(String.fromCodePoint(0xfffd));
      if (result.length > 0) expect(result.endsWith("…")).toBe(true);
    }
  });
});
