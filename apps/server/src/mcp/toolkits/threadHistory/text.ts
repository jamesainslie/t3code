const ELLIPSIS = "…";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ELLIPSIS_BYTES = encoder.encode(ELLIPSIS).length;

/**
 * Cuts `text` to at most `maxBytes` UTF-8 bytes, ellipsis included. A cut backs off to a code
 * point boundary so it never splits a character. Returns "" when not even the ellipsis fits.
 */
export function cutToBytes(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes - ELLIPSIS_BYTES;
  if (end < 0) return "";
  // UTF-8 continuation bytes look like 0b10xxxxxx; the character starts before them.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.subarray(0, end)) + ELLIPSIS;
}
