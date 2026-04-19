import { describe, expect, it } from "vitest";

import {
  type LocalStorageLike,
  T3StorageAdapter,
} from "../StorageAdapter.ts";

const makeMemoryStorage = (): LocalStorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

describe("T3StorageAdapter.getSync", () => {
  it("returns an empty record when no keys are stored", async () => {
    const adapter = new T3StorageAdapter({ backing: makeMemoryStorage() });
    const result = await adapter.getSync(["theme"]);
    expect(result).toEqual({});
  });

  it("returns the previously-set value", async () => {
    const adapter = new T3StorageAdapter({ backing: makeMemoryStorage() });
    await adapter.setSync({ theme: "catppuccin-mocha" });
    const result = await adapter.getSync(["theme"]);
    expect(result).toEqual({ theme: "catppuccin-mocha" });
  });

  it("accepts a single string key (mdview's getSync contract)", async () => {
    const adapter = new T3StorageAdapter({ backing: makeMemoryStorage() });
    await adapter.setSync({ theme: "github-light" });
    const result = await adapter.getSync("theme");
    expect(result).toEqual({ theme: "github-light" });
  });

  it("namespaces keys under t3code:mdreview: in the backing store", async () => {
    const backing = makeMemoryStorage();
    const adapter = new T3StorageAdapter({ backing });
    await adapter.setSync({ theme: "monokai" });
    expect(backing.getItem("t3code:mdreview:theme")).toBe('"monokai"');
    // An unnamespaced key is not set.
    expect(backing.getItem("theme")).toBeNull();
  });

  it("preserves structured values via JSON encoding", async () => {
    const adapter = new T3StorageAdapter({ backing: makeMemoryStorage() });
    await adapter.setSync({ prefs: { mermaidTheme: "dark", tocEnabled: true } });
    const result = await adapter.getSync(["prefs"]);
    expect(result).toEqual({
      prefs: { mermaidTheme: "dark", tocEnabled: true },
    });
  });
});

describe("T3StorageAdapter.getLocal / setLocal", () => {
  it("mirrors sync semantics under a separate namespace", async () => {
    const backing = makeMemoryStorage();
    const adapter = new T3StorageAdapter({ backing });
    await adapter.setLocal({ lastOpenedFile: "docs/a.md" });
    expect(backing.getItem("t3code:mdreview:local:lastOpenedFile")).toBe(
      '"docs/a.md"',
    );
    const got = await adapter.getLocal(["lastOpenedFile"]);
    expect(got).toEqual({ lastOpenedFile: "docs/a.md" });
  });

  it("isolates sync and local stores from one another", async () => {
    const adapter = new T3StorageAdapter({ backing: makeMemoryStorage() });
    await adapter.setSync({ theme: "mocha" });
    await adapter.setLocal({ theme: "latte" });
    expect(await adapter.getSync(["theme"])).toEqual({ theme: "mocha" });
    expect(await adapter.getLocal(["theme"])).toEqual({ theme: "latte" });
  });
});

describe("T3StorageAdapter malformed data", () => {
  it("ignores stored values that fail to JSON.parse", async () => {
    const backing = makeMemoryStorage();
    backing.setItem("t3code:mdreview:theme", "{not-json");
    const adapter = new T3StorageAdapter({ backing });
    const result = await adapter.getSync(["theme"]);
    expect(result).toEqual({});
  });
});
