// Fork-only. Lathe's renderer storage keys start with "lathe:" and "lathe.";
// before the rename they started with "t3code:", "t3code.", "t3:" and "t3.".
// index.html loads this before any other script, so the app finds what an
// earlier build saved under the new key. A key already saved under its new
// name wins, and the old keys stay for an older build.
(() => {
  const RENAMES = [
    ["t3code:", "lathe:"],
    ["t3code.", "lathe."],
    ["t3:", "lathe:"],
    ["t3.", "lathe."],
  ];
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null) keys.push(key);
    }
    for (const key of keys) {
      const rename = RENAMES.find(([from]) => key.startsWith(from));
      if (!rename) continue;
      const next = rename[1] + key.slice(rename[0].length);
      if (localStorage.getItem(next) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(next, value);
    }
  } catch {
    // Storage can be unavailable (private modes, sandboxed frames); the app then starts fresh.
  }
})();
