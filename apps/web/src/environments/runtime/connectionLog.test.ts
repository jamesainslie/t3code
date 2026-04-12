import { afterEach, describe, expect, it } from "vitest";

import {
  connectionLog,
  resetConnectionLogForTests,
  useConnectionLogStore,
} from "./connectionLog";

afterEach(() => {
  resetConnectionLogForTests();
});

describe("useConnectionLogStore", () => {
  it("starts with an empty entries array", () => {
    expect(useConnectionLogStore.getState().entries).toEqual([]);
  });

  it("push adds entries with auto-generated id and timestamp", () => {
    useConnectionLogStore.getState().push({
      level: "info",
      source: "test",
      identityKey: null,
      label: null,
      message: "hello",
    });

    const entries = useConnectionLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("1");
    expect(entries[0]!.timestamp).toBeTruthy();
    expect(entries[0]!.level).toBe("info");
    expect(entries[0]!.source).toBe("test");
    expect(entries[0]!.message).toBe("hello");
  });

  it("push preserves optional detail when provided", () => {
    useConnectionLogStore.getState().push({
      level: "error",
      source: "test",
      identityKey: "k1",
      label: "my-remote",
      message: "boom",
      detail: { code: 42 },
    });

    const entry = useConnectionLogStore.getState().entries[0]!;
    expect(entry.detail).toEqual({ code: 42 });
    expect(entry.identityKey).toBe("k1");
    expect(entry.label).toBe("my-remote");
  });

  it("enforces the ring buffer limit of 500 entries", () => {
    const store = useConnectionLogStore.getState();
    for (let i = 0; i < 510; i++) {
      store.push({
        level: "info",
        source: "test",
        identityKey: null,
        label: null,
        message: `msg-${i}`,
      });
    }

    const entries = useConnectionLogStore.getState().entries;
    expect(entries).toHaveLength(500);
    // Oldest entries should have been dropped; the first remaining is msg-10
    expect(entries[0]!.message).toBe("msg-10");
    expect(entries[entries.length - 1]!.message).toBe("msg-509");
  });

  it("clear empties the entries", () => {
    useConnectionLogStore.getState().push({
      level: "info",
      source: "test",
      identityKey: null,
      label: null,
      message: "hello",
    });
    useConnectionLogStore.getState().clear();
    expect(useConnectionLogStore.getState().entries).toEqual([]);
  });
});

describe("connectionLog helper", () => {
  it("pushes an entry with defaults for missing opts", () => {
    connectionLog("warn", "mySource", "something happened");

    const entries = useConnectionLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe("warn");
    expect(entries[0]!.source).toBe("mySource");
    expect(entries[0]!.message).toBe("something happened");
    expect(entries[0]!.identityKey).toBeNull();
    expect(entries[0]!.label).toBeNull();
    expect(entries[0]!.detail).toBeUndefined();
  });

  it("passes through identityKey, label, and detail from opts", () => {
    connectionLog("error", "src", "fail", {
      identityKey: "ik",
      label: "lbl",
      detail: "extra",
    });

    const entry = useConnectionLogStore.getState().entries[0]!;
    expect(entry.identityKey).toBe("ik");
    expect(entry.label).toBe("lbl");
    expect(entry.detail).toBe("extra");
  });
});
