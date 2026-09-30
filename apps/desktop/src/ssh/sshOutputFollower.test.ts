import type { DesktopSshOutputEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeSshOutputFollower } from "./sshOutputFollower.ts";

const entry = (seq: number): DesktopSshOutputEntry => ({
  seq,
  at: "2026-09-30T12:00:00.000Z",
  source: "launch",
  stderr: true,
  text: `line ${seq}`,
});

describe("makeSshOutputFollower", () => {
  it("delivers the snapshot, then only newer lines for its own target", () => {
    const delivered: number[][] = [];
    const follower = makeSshOutputFollower((entries) => {
      delivered.push(entries.map((item) => item.seq));
    });
    // A push can beat the subscribe reply; it waits, and anything the snapshot already holds
    // is not delivered twice.
    follower.push({ key: "devbox", entries: [entry(3)] });
    follower.push({ key: "staging", entries: [entry(9)] });
    follower.snapshot({ key: "devbox", entries: [entry(1), entry(2), entry(3)] });
    follower.push({ key: "devbox", entries: [entry(3), entry(4)] });
    follower.push({ key: "staging", entries: [entry(5)] });

    expect(delivered).toEqual([[1, 2, 3], [4]]);
  });

  it("stays quiet when there is nothing new", () => {
    const delivered: number[][] = [];
    const follower = makeSshOutputFollower((entries) => {
      delivered.push(entries.map((item) => item.seq));
    });
    follower.snapshot({ key: "devbox", entries: [] });
    follower.push({ key: "devbox", entries: [] });
    expect(delivered).toEqual([]);
  });
});
