import { describe, expect, it } from "vite-plus/test";

import { makeSshOutputBuffer } from "./sshOutputBuffer.ts";

const AT = "2026-09-30T12:00:00.000Z";
const lines = (entries: ReadonlyArray<{ readonly text: string }>) =>
  entries.map((entry) => entry.text);

describe("makeSshOutputBuffer", () => {
  it("joins chunks into whole lines and holds an unfinished line back", () => {
    const buffer = makeSshOutputBuffer();
    expect(buffer.append({ source: "launch", stream: "stderr", text: "install" }, AT)).toEqual([]);
    const added = buffer.append(
      { source: "launch", stream: "stderr", text: "ing t3\r\nstarting\rready\n\npartial" },
      AT,
    );
    expect(lines(added)).toEqual(["installing t3", "starting", "ready"]);
    expect(added.map((entry) => [entry.seq, entry.source, entry.stderr])).toEqual([
      [1, "launch", true],
      [2, "launch", true],
      [3, "launch", true],
    ]);
  });

  it("keeps each source and stream's unfinished line apart", () => {
    const buffer = makeSshOutputBuffer();
    buffer.append({ source: "launch", stream: "stdout", text: '{"remote' }, AT);
    buffer.append({ source: "tunnel", stream: "stderr", text: "channel 2: " }, AT);
    buffer.append({ source: "launch", stream: "stdout", text: 'Port":3773}\n' }, AT);
    expect(lines(buffer.entries())).toEqual(['{"remotePort":3773}']);
  });

  it("redacts a token even when it arrives split across chunks", () => {
    const buffer = makeSshOutputBuffer();
    buffer.append(
      { source: "remote-log", stream: "stdout", text: "pairingUrl: http://h/pair#tok" },
      AT,
    );
    buffer.append({ source: "remote-log", stream: "stdout", text: "en=E5YZ6LG6RVH8\n" }, AT);
    expect(lines(buffer.entries())).toEqual(["pairingUrl: http://h/pair#token=[redacted]"]);
  });

  it("flushes unfinished lines before an attempt marker", () => {
    const buffer = makeSshOutputBuffer();
    buffer.append({ source: "launch", stream: "stderr", text: "Connection timed out" }, AT);
    const marked = buffer.mark("Failed: SSH command timed out after 90000ms.", AT);
    expect(marked.map((entry) => [entry.source, entry.stderr, entry.text])).toEqual([
      ["launch", true, "Connection timed out"],
      ["status", false, "Failed: SSH command timed out after 90000ms."],
    ]);
    // The flushed line does not come back with the next chunk.
    expect(
      lines(buffer.append({ source: "launch", stream: "stderr", text: "next\n" }, AT)),
    ).toEqual(["next"]);
  });

  it("keeps the newest lines within its caps", () => {
    const buffer = makeSshOutputBuffer({ maxLines: 3, maxLineLength: 5 });
    buffer.append({ source: "tunnel", stream: "stderr", text: "one\ntwo\nthree\nfour\n" }, AT);
    buffer.append({ source: "tunnel", stream: "stderr", text: "a very long line\n" }, AT);
    expect(lines(buffer.entries())).toEqual(["three", "four", "a ver…"]);
    expect(buffer.entries().map((entry) => entry.seq)).toEqual([3, 4, 5]);
  });
});
