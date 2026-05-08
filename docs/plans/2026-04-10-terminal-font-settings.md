# Terminal Font Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users choose the font family and size for terminal sessions, with first-class Nerd Font support and a live inline preview in settings.

**Architecture:** Two new fields (`terminalFontFamily`, `terminalFontSize`) added to the client-only settings schema. The settings panel gets a new "Terminal" section with a curated font preset dropdown (with custom escape hatch), a numeric size input, and a live preview swatch. The terminal drawer reads these settings reactively and applies them to open xterm instances without restart.

**Tech Stack:** Effect Schema, React, xterm.js, Vitest

---

### Task 1: Add terminal font fields to ClientSettingsSchema

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Create: `packages/contracts/src/settings.test.ts` (if not exists, otherwise append)

**Step 1: Write failing tests for the new schema fields**

Create `packages/contracts/src/settings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "./settings";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("ClientSettingsSchema", () => {
  describe("terminal font settings", () => {
    it("defaults terminalFontFamily to empty string", () => {
      const parsed = decodeClientSettings({});
      expect(parsed.terminalFontFamily).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
      expect(parsed.terminalFontFamily).toBe("");
    });

    it("defaults terminalFontSize to 12", () => {
      const parsed = decodeClientSettings({});
      expect(parsed.terminalFontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE);
      expect(parsed.terminalFontSize).toBe(12);
    });

    it("accepts a custom font family string", () => {
      const parsed = decodeClientSettings({
        terminalFontFamily: "JetBrainsMono Nerd Font",
      });
      expect(parsed.terminalFontFamily).toBe("JetBrainsMono Nerd Font");
    });

    it("accepts font sizes within the valid range", () => {
      const small = decodeClientSettings({ terminalFontSize: 8 });
      expect(small.terminalFontSize).toBe(8);

      const large = decodeClientSettings({ terminalFontSize: 24 });
      expect(large.terminalFontSize).toBe(24);
    });

    it("rejects font sizes below the minimum", () => {
      expect(() => decodeClientSettings({ terminalFontSize: 5 })).toThrow();
    });

    it("rejects font sizes above the maximum", () => {
      expect(() => decodeClientSettings({ terminalFontSize: 30 })).toThrow();
    });

    it("rejects non-integer font sizes", () => {
      expect(() => decodeClientSettings({ terminalFontSize: 12.5 })).toThrow();
    });

    it("includes terminal settings in DEFAULT_CLIENT_SETTINGS", () => {
      expect(DEFAULT_CLIENT_SETTINGS.terminalFontFamily).toBe("");
      expect(DEFAULT_CLIENT_SETTINGS.terminalFontSize).toBe(12);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test --cwd packages/contracts -- --run src/settings.test.ts`
Expected: FAIL — imports don't exist yet.

**Step 3: Implement the schema changes**

In `packages/contracts/src/settings.ts`, add these constants and fields:

After the existing `DEFAULT_SIDEBAR_THREAD_SORT_ORDER` line (line 24), add:

```typescript
export const DEFAULT_TERMINAL_FONT_FAMILY = "";
export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 24;
```

Then add two new fields to `ClientSettingsSchema` (inside the `Schema.Struct({...})` after the `timestampFormat` field):

```typescript
  terminalFontFamily: Schema.String.pipe(
    Schema.withDecodingDefault(() => DEFAULT_TERMINAL_FONT_FAMILY),
  ),
  terminalFontSize: Schema.Int.pipe(
    Schema.greaterThanOrEqualTo(TERMINAL_FONT_SIZE_MIN),
    Schema.lessThanOrEqualTo(TERMINAL_FONT_SIZE_MAX),
    Schema.withDecodingDefault(() => DEFAULT_TERMINAL_FONT_SIZE),
  ),
```

Also export the constants from the settings barrel if needed (check if `settings.ts` is re-exported from `index.ts`).

**Step 4: Run tests to verify they pass**

Run: `bun run test --cwd packages/contracts -- --run src/settings.test.ts`
Expected: PASS — all 8 tests green.

**Step 5: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: Clean.

**Step 6: Commit**

```
feat(contracts): add terminal font settings to client schema
```

---

### Task 2: Add terminal font preset constants

**Files:**

- Create: `apps/web/src/terminalFonts.ts`

This module holds the curated preset list and the helper that resolves a setting value to a CSS font-family string. Keeping it in its own module lets both the settings panel and the terminal drawer import it without circular deps.

**Step 1: Write failing tests**

Create `apps/web/src/terminalFonts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_FONT_STACK,
  TERMINAL_FONT_PRESETS,
  resolveTerminalFontFamily,
} from "./terminalFonts";

describe("TERMINAL_FONT_PRESETS", () => {
  it("has a non-empty list of presets", () => {
    expect(TERMINAL_FONT_PRESETS.length).toBeGreaterThan(0);
  });

  it("every preset has a value and label", () => {
    for (const preset of TERMINAL_FONT_PRESETS) {
      expect(preset.value).toBeTruthy();
      expect(preset.label).toBeTruthy();
    }
  });

  it("does not include 'custom' as a preset value", () => {
    const values = TERMINAL_FONT_PRESETS.map((p) => p.value);
    expect(values).not.toContain("custom");
  });
});

describe("resolveTerminalFontFamily", () => {
  it("returns the default font stack for an empty string", () => {
    expect(resolveTerminalFontFamily("")).toBe(DEFAULT_TERMINAL_FONT_STACK);
  });

  it("returns a preset font with monospace fallback", () => {
    expect(resolveTerminalFontFamily("JetBrainsMono Nerd Font")).toBe(
      '"JetBrainsMono Nerd Font", monospace',
    );
  });

  it("returns a custom font with monospace fallback", () => {
    expect(resolveTerminalFontFamily("IosevkaTerm Nerd Font")).toBe(
      '"IosevkaTerm Nerd Font", monospace',
    );
  });

  it("trims whitespace from custom font names", () => {
    expect(resolveTerminalFontFamily("  Hack Nerd Font  ")).toBe('"Hack Nerd Font", monospace');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test --cwd apps/web -- --run src/terminalFonts.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement the module**

Create `apps/web/src/terminalFonts.ts`:

```typescript
/**
 * Terminal font presets and resolution logic.
 *
 * Shared between the settings panel (font picker UI) and the terminal drawer
 * (applying the chosen font to xterm instances).
 */

/** The fallback font stack used when no custom font is configured. */
export const DEFAULT_TERMINAL_FONT_STACK =
  '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

/** Curated presets shown in the font dropdown. */
export const TERMINAL_FONT_PRESETS = [
  { value: "JetBrainsMono Nerd Font", label: "JetBrains Mono Nerd Font" },
  { value: "FiraCode Nerd Font", label: "Fira Code Nerd Font" },
  { value: "Hack Nerd Font", label: "Hack Nerd Font" },
  { value: "MesloLGS Nerd Font", label: "MesloLGS Nerd Font" },
  { value: "CaskaydiaCove Nerd Font", label: "Cascadia Code Nerd Font" },
  { value: "0xProto Nerd Font", label: "0xProto Nerd Font" },
  { value: "SF Mono", label: "SF Mono (default)" },
] as const;

/**
 * Resolve a settings value to a CSS `fontFamily` string for xterm.
 *
 * - Empty string → full default font stack (SF Mono + fallbacks).
 * - Any other value → `"<font>", monospace` with a monospace fallback.
 */
export function resolveTerminalFontFamily(settingValue: string): string {
  const trimmed = settingValue.trim();
  if (trimmed === "") return DEFAULT_TERMINAL_FONT_STACK;
  return `"${trimmed}", monospace`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test --cwd apps/web -- --run src/terminalFonts.test.ts`
Expected: PASS — all 7 tests green.

**Step 5: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: Clean.

**Step 6: Commit**

```
feat(web): add terminal font preset constants and resolver
```

---

### Task 3: Wire terminal drawer to read font settings

**Files:**

- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`

**Step 1: Identify the changes needed**

The terminal drawer creates xterm instances in a `useEffect` (around line 258). Currently it hardcodes `fontSize: 12` and `fontFamily: '"SF Mono"...'`. We need to:

1. Import `useSettings` and `resolveTerminalFontFamily`.
2. Read `terminalFontFamily` and `terminalFontSize` from settings.
3. Pass them into the `Terminal` constructor.
4. Add a reactive effect that updates open terminals when settings change.

**Step 2: Add the settings import and read**

At the top of `ThreadTerminalDrawer.tsx`, add these imports:

```typescript
import { useSettings } from "~/hooks/useSettings";
import { resolveTerminalFontFamily } from "~/terminalFonts";
```

In the `TerminalInstance` component (the one containing the `useEffect` that creates the terminal — find the component that has `containerRef` and creates `new Terminal({...})`), add the settings read before the `useEffect`:

```typescript
const terminalFontFamily = useSettings((s) => s.terminalFontFamily);
const terminalFontSize = useSettings((s) => s.terminalFontSize);
```

**Step 3: Replace hardcoded values in Terminal constructor**

Change the terminal construction from:

```typescript
const terminal = new Terminal({
  cursorBlink: true,
  lineHeight: 1.2,
  fontSize: 12,
  scrollback: 5_000,
  fontFamily: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  theme: terminalThemeFromApp(),
});
```

To:

```typescript
const terminal = new Terminal({
  cursorBlink: true,
  lineHeight: 1.2,
  fontSize: terminalFontSize,
  scrollback: 5_000,
  fontFamily: resolveTerminalFontFamily(terminalFontFamily),
  theme: terminalThemeFromApp(),
});
```

**Important:** Add `terminalFontFamily` and `terminalFontSize` to the `useEffect` dependency array so the terminal reinitializes when settings change. If the effect cleans up and re-creates the terminal, this is sufficient. If not, proceed to step 4.

**Step 4: Add reactive update for settings changes**

If the terminal creation `useEffect` has a cleanup that disposes the terminal, adding the settings to the dep array is enough — xterm will be recreated with the new values.

If the effect does NOT recreate on those deps (check the dep array), add a separate `useEffect` that updates the running terminal:

```typescript
useEffect(() => {
  const terminal = terminalRef.current;
  const fitAddon = fitAddonRef.current;
  if (!terminal || !fitAddon) return;
  terminal.options.fontFamily = resolveTerminalFontFamily(terminalFontFamily);
  terminal.options.fontSize = terminalFontSize;
  fitAddon.fit();
}, [terminalFontFamily, terminalFontSize]);
```

This is the same pattern used by the existing `MutationObserver` for theme changes (line 484-493) — mutate `terminal.options`, then refit.

**Step 5: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: Clean.

**Step 6: Manual smoke test**

1. Run `bun dev`.
2. Open a terminal session.
3. Open settings, change the font to a Nerd Font you have installed.
4. Verify the open terminal updates immediately.
5. Change the font size, verify it updates.
6. Reload — verify the setting persists.

**Step 7: Commit**

```
feat(web): read terminal font settings in terminal drawer
```

---

### Task 4: Add Terminal section to Settings panel

**Files:**

- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`

This is the largest task — adds the "Terminal" `SettingsSection` with two `SettingsRow`s (font family, font size) and a live inline preview.

**Step 1: Add imports**

At the top of `SettingsPanels.tsx`, add to the existing import from `@t3tools/contracts/settings`:

```typescript
import {
  DEFAULT_UNIFIED_SETTINGS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "@t3tools/contracts/settings";
```

Add a new import:

```typescript
import {
  DEFAULT_TERMINAL_FONT_STACK,
  TERMINAL_FONT_PRESETS,
  resolveTerminalFontFamily,
} from "../../terminalFonts";
```

**Step 2: Add the font preset options constant**

Near the top of the file (next to `THEME_OPTIONS` and `TIMESTAMP_FORMAT_LABELS`):

```typescript
/** Sentinel value for the "Custom" option in the font dropdown. */
const CUSTOM_FONT_SENTINEL = "__custom__";

function getTerminalFontSelectValue(fontFamily: string): string {
  if (fontFamily === "") return "";
  const isPreset = TERMINAL_FONT_PRESETS.some((p) => p.value === fontFamily);
  return isPreset ? fontFamily : CUSTOM_FONT_SENTINEL;
}

function getTerminalFontLabel(fontFamily: string): string {
  if (fontFamily === "") return "Default (SF Mono)";
  const preset = TERMINAL_FONT_PRESETS.find((p) => p.value === fontFamily);
  if (preset) return preset.label;
  return "Custom";
}
```

**Step 3: Add the TerminalSettingsSection component**

Create a new component inside `SettingsPanels.tsx` (before `GeneralSettingsPanel`):

```typescript
function TerminalSettingsSection() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [customFontInput, setCustomFontInput] = useState(
    () => {
      const isPreset = settings.terminalFontFamily === "" ||
        TERMINAL_FONT_PRESETS.some((p) => p.value === settings.terminalFontFamily);
      return isPreset ? "" : settings.terminalFontFamily;
    },
  );

  const selectValue = getTerminalFontSelectValue(settings.terminalFontFamily);
  const isCustom = selectValue === CUSTOM_FONT_SENTINEL;
  const resolvedFontCss = resolveTerminalFontFamily(settings.terminalFontFamily);

  return (
    <SettingsSection title="Terminal">
      <SettingsRow
        title="Terminal font"
        description="Font family for terminal sessions. Nerd Font variants include patched icons."
        resetAction={
          settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily ? (
            <SettingResetButton
              label="terminal font"
              onClick={() => {
                updateSettings({
                  terminalFontFamily: DEFAULT_UNIFIED_SETTINGS.terminalFontFamily,
                });
                setCustomFontInput("");
              }}
            />
          ) : null
        }
        control={
          <Select
            value={selectValue}
            onValueChange={(value) => {
              if (value === CUSTOM_FONT_SENTINEL) {
                updateSettings({ terminalFontFamily: customFontInput || "" });
              } else {
                updateSettings({ terminalFontFamily: value });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Terminal font family">
              <SelectValue>{getTerminalFontLabel(settings.terminalFontFamily)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="">
                Default (SF Mono)
              </SelectItem>
              {TERMINAL_FONT_PRESETS.map((preset) => (
                <SelectItem hideIndicator key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
              <SelectItem hideIndicator value={CUSTOM_FONT_SENTINEL}>
                Custom
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      >
        {isCustom ? (
          <div className="pt-2">
            <Input
              value={customFontInput}
              placeholder='e.g. "IosevkaTerm Nerd Font"'
              onChange={(event) => {
                const next = event.target.value;
                setCustomFontInput(next);
                updateSettings({ terminalFontFamily: next });
              }}
              aria-label="Custom terminal font family"
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Font size"
        description="Text size in pixels for terminal sessions."
        resetAction={
          settings.terminalFontSize !== DEFAULT_UNIFIED_SETTINGS.terminalFontSize ? (
            <SettingResetButton
              label="font size"
              onClick={() =>
                updateSettings({
                  terminalFontSize: DEFAULT_UNIFIED_SETTINGS.terminalFontSize,
                })
              }
            />
          ) : null
        }
        control={
          <Input
            type="number"
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            value={settings.terminalFontSize}
            onChange={(event) => {
              const raw = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(raw)) return;
              const clamped = Math.max(
                TERMINAL_FONT_SIZE_MIN,
                Math.min(TERMINAL_FONT_SIZE_MAX, raw),
              );
              updateSettings({ terminalFontSize: clamped });
            }}
            className="w-20 text-center"
            aria-label="Terminal font size"
          />
        }
      />

      {/* Inline preview */}
      <div className="border-t border-border px-4 py-4 sm:px-5">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Preview
        </p>
        <div
          className="overflow-hidden rounded-lg bg-[oklch(0.21_0.034_264.665)] p-4 text-[oklch(0.929_0.013_285.938)] dark:bg-[oklch(0.16_0.02_264)] dark:text-[oklch(0.87_0.013_285)]"
          style={{
            fontFamily: resolvedFontCss,
            fontSize: settings.terminalFontSize,
            lineHeight: 1.4,
          }}
        >
          <div>
            <span style={{ color: "oklch(0.7 0.15 145)" }}>{"❯"}</span>{" "}
            <span style={{ color: "oklch(0.7 0.15 250)" }}>~/projects/t3code</span>{" "}
            <span style={{ color: "oklch(0.7 0.12 50)" }}>main</span>
          </div>
          <div>$ bun dev</div>
          <div style={{ color: "oklch(0.7 0.15 145)" }}>{"❯"} Starting dev server...</div>
          <div>
            {"  "}
            <span style={{ color: "oklch(0.7 0.15 250)" }}>Local:</span>
            {"   http://localhost:5733"}
          </div>
          <div>
            {"  "}
            <span style={{ color: "oklch(0.7 0.15 250)" }}>Network:</span>
            {" http://192.168.1.10:5733"}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
```

**Step 4: Insert the section into GeneralSettingsPanel**

In the `GeneralSettingsPanel` function, after the closing `</SettingsSection>` for the "General" section (around line 1071) and before the "Providers" section (around line 1073), add:

```tsx
<TerminalSettingsSection />
```

**Step 5: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: Clean.

**Step 6: Manual smoke test**

1. Run `bun dev`.
2. Open Settings from the sidebar.
3. Verify the "Terminal" section appears between "General" and "Providers".
4. Select a Nerd Font preset — verify the preview updates immediately.
5. Select "Custom" — verify the text input appears.
6. Type a font name — verify the preview updates.
7. Change the font size — verify the preview updates.
8. Click the reset button — verify both revert to defaults.
9. Open a terminal session — verify it uses the selected font.
10. Switch theme (light ↔ dark) — verify the preview adapts.

**Step 7: Commit**

```
feat(web): add Terminal section to settings with font picker and preview
```

---

### Task 5: Final verification

**Step 1: Run the full test suite**

Run: `bun run test`
Expected: All tests pass.

**Step 2: Run all quality checks**

Run: `bun fmt && bun lint && bun typecheck`
Expected: All clean.

**Step 3: End-to-end walkthrough**

1. Fresh load (clear localStorage) — terminal uses SF Mono at 12px.
2. Set font to "JetBrainsMono Nerd Font", size 16 — terminal and preview update.
3. Reload page — settings persist, terminal uses JetBrains Mono at 16.
4. Set to "Custom", type "IosevkaTerm Nerd Font" — terminal updates.
5. Reset font — reverts to default. Reset size — reverts to 12.
6. Open multiple terminal tabs — all use the same font settings.

**Step 4: Commit (if any fixups needed)**

```
chore: fixups from terminal font settings verification
```
