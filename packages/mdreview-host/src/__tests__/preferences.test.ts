import { DEFAULT_PREFERENCES, type Preferences } from "@mdreview/core";
import { describe, expect, it } from "vitest";

import {
  MDREVIEW_PREFERENCES_CHANGED_EVENT,
  normalizeMdreviewPreferences,
  readMdreviewPreferences,
  writeMdreviewPreferences,
} from "../preferences.ts";
import { type LocalStorageLike, T3StorageAdapter } from "../StorageAdapter.ts";

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

describe("normalizeMdreviewPreferences", () => {
  it("merges stored preferences over MD Review defaults", () => {
    const preferences = normalizeMdreviewPreferences({
      lineNumbers: true,
      theme: "monokai-pro",
      tocMaxDepth: 3,
    });

    expect(preferences.lineNumbers).toBe(true);
    expect(preferences.theme).toBe("monokai-pro");
    expect(preferences.tocMaxDepth).toBe(3);
    expect(preferences.enableHtml).toBe(DEFAULT_PREFERENCES.enableHtml);
  });

  it("drops invalid values instead of poisoning renderer state", () => {
    const preferences = normalizeMdreviewPreferences({
      lineNumbers: "yes",
      theme: "not-a-theme",
      tocMaxDepth: 99,
    });

    expect(preferences.lineNumbers).toBe(DEFAULT_PREFERENCES.lineNumbers);
    expect(preferences.theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(preferences.tocMaxDepth).toBe(DEFAULT_PREFERENCES.tocMaxDepth);
  });
});

describe("readMdreviewPreferences / writeMdreviewPreferences", () => {
  it("persists preferences under the MD Review storage key", async () => {
    const backing = makeMemoryStorage();
    const storage = new T3StorageAdapter({ backing });
    const preferences: Preferences = {
      ...DEFAULT_PREFERENCES,
      lineNumbers: true,
      showToc: true,
    };

    await writeMdreviewPreferences(storage, preferences);

    expect(backing.getItem("t3code:mdreview:preferences")).toContain('"lineNumbers":true');
    await expect(readMdreviewPreferences(storage)).resolves.toMatchObject({
      lineNumbers: true,
      showToc: true,
    });
  });

  it("exports the DOM event name used to refresh mounted renderers", () => {
    expect(MDREVIEW_PREFERENCES_CHANGED_EVENT).toBe("t3code:mdreview-preferences-changed");
  });
});
