// Fork-only. index.html loads this before any other script, so keys a pre-rename build saved
// under "t3code:", "t3code.", "t3:" or "t3." are found under their "lathe:" or "lathe." name.
// A key already saved under its new name wins, and the old keys stay for an older build.
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
