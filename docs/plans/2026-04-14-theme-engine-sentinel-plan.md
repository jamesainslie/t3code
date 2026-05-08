# Theme Engine Phase 1 — Sentinel Execution Plan

**Status:** Ready to execute
**Implementation reference:** `docs/plans/2026-04-14-theme-engine-plan.md` (code samples)
**Design reference:** `docs/plans/2026-04-14-theme-engine-design.md`
**Sentinel protocol:** Active — every checkpoint must pass all six layers before advancing.

## Execution Rules

- Each step is one Sentinel checkpoint. Do not advance until the previous checkpoint passes.
- Build command for all Vitest unit tests: `bun run test` (full suite) or per-file as noted.
- Build command for TypeScript: `bun run build` (all packages).
- Issue tracker: check for `.beads/` first, fall back to `gh issue create`.
- Completion contract template must be appended verbatim to every dev agent prompt.

---

## Step 1: Theme Type Definitions

**Depends on:** nothing (foundation)

### Deliverables

1. `packages/contracts/src/theme.ts` (create, ~120 lines)
   - Exports: `ThemeBase` (Schema.Literal), `ColorTokensSchema` (Schema.Struct, 42 optional fields), `TypographyTokensSchema` (Schema.Struct, 6 optional fields), `TransparencyTokensSchema` (Schema.Struct, 2 optional fields), `IconSetConfigSchema` (Schema.Struct), `ThemeOverridesSchema` (Schema.Struct), `ThemeMetadataSchema` (Schema.Struct with decoding defaults), `ThemeSchema` (Schema.Struct), `DEFAULT_TYPOGRAPHY_TOKENS` (const, all keys non-optional), `DEFAULT_TRANSPARENCY_TOKENS` (const, all keys non-optional)
   - Exports types: `ColorTokens`, `TypographyTokens`, `TransparencyTokens`, `ThemeOverrides`, `ThemeMetadata`, `Theme`, `ThemeBase` (type), `ResolvedColorTokens` (interface — all keys required strings), `ResolvedTheme` (interface)

2. `packages/contracts/src/theme.test.ts` (create, ~80 lines)

3. `packages/contracts/src/index.ts` (modify, +1 line)
   - Adds: `export * from "./theme"`

### Test Scenarios (theme.test.ts)

- Decodes minimal theme with only `id`, `name`, `base` — `overrides` defaults to `{}`, `metadata.version` defaults to `1`
- Decodes theme with partial color overrides — `background` and `foreground` set, `sidebarBackground` is `undefined` (sparse model)
- Rejects invalid base values (`"sepia"` throws)
- Encodes a theme to a JSON-safe object (encode/decode roundtrip)
- `DEFAULT_TYPOGRAPHY_TOKENS.codeFontFamily` contains `"monospace"`, `uiFontSize` is `"14px"`
- `DEFAULT_TRANSPARENCY_TOKENS.windowOpacity` is `1`
- `ThemeBase` accepts `"light"` and `"dark"`, rejects `"system"`

### Build/Test Commands

```bash
bun run --cwd packages/contracts vitest run src/theme.test.ts
bun run build
```

### Sentinel Integration Checks (Layer 6)

- `index.ts` re-exports `ThemeSchema`, `ColorTokens`, `ResolvedTheme` — verify these names appear in the package's public exports
- No circular imports within `packages/contracts`
- `ResolvedColorTokens` has all 42 keys from `ColorTokensSchema` as required `string` (not optional)

---

## Step 2: Base Theme Defaults

**Depends on:** Step 1 (`ResolvedColorTokens` type)

### Deliverables

1. `apps/web/src/theme/defaults.ts` (create, ~120 lines)
   - Exports: `LIGHT_DEFAULTS: ResolvedColorTokens`, `DARK_DEFAULTS: ResolvedColorTokens`
   - Both objects must have all 42 keys of `ResolvedColorTokens` as string values
   - Values extracted from: `apps/web/src/index.css` `:root {}` / `@variant dark {}` blocks, and terminal palette from `apps/web/src/components/ThreadTerminalDrawer.tsx`

2. `apps/web/src/theme/defaults.test.ts` (create, ~50 lines)

### Test Scenarios (defaults.test.ts)

- `LIGHT_DEFAULTS` has all required color token keys (spot-check: `background`, `foreground`, `primary`, `primaryForeground`, `border`, `terminalBlack`, `terminalBrightWhite`)
- `DARK_DEFAULTS` has all required color token keys (same spot-check)
- `LIGHT_DEFAULTS.background` !== `DARK_DEFAULTS.background`
- `LIGHT_DEFAULTS.foreground` !== `DARK_DEFAULTS.foreground`
- Every key in `LIGHT_DEFAULTS` exists in `DARK_DEFAULTS` (parity check)
- Every key in `DARK_DEFAULTS` exists in `LIGHT_DEFAULTS` (parity check)

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/theme/defaults.test.ts
```

### Sentinel Integration Checks (Layer 6)

- `LIGHT_DEFAULTS` and `DARK_DEFAULTS` are assignable to `ResolvedColorTokens` from `@t3tools/contracts` (no TypeScript errors)
- No values are empty strings — every token has a real color value
- Terminal palette (20 keys: `terminalBackground` through `terminalBrightWhite`) populated in both objects

---

## Step 3: Theme Resolution Engine

**Depends on:** Steps 1, 2 (`Theme`, `ResolvedTheme`, `DARK_DEFAULTS`, `LIGHT_DEFAULTS`)

### Deliverables

1. `apps/web/src/theme/engine.ts` (create, ~60 lines)
   - Exports: `resolveTheme(theme: Theme): ResolvedTheme`
   - Internal (not exported): `getBaseColors`, `mergeColors`, `mergeTypography`, `mergeTransparency`

2. `apps/web/src/theme/engine.test.ts` (create, ~70 lines)

### Test Scenarios (engine.test.ts)

- Light base + no overrides → all tokens match `LIGHT_DEFAULTS`
- Dark base + no overrides → all tokens match `DARK_DEFAULTS`
- Dark base + color overrides (`background`, `primary`) → overridden tokens use custom values, non-overridden tokens use `DARK_DEFAULTS`
- Light base + typography overrides (`codeFontFamily`) → overridden token uses custom value, `uiFontFamily` uses `DEFAULT_TYPOGRAPHY_TOKENS.uiFontFamily`
- Dark base + transparency overrides (`windowOpacity: 0.85`) → overridden value used, `vibrancy` uses `DEFAULT_TRANSPARENCY_TOKENS.vibrancy`
- Resolved theme carries through `id` and `name` unchanged

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/theme/engine.test.ts
```

### Sentinel Integration Checks (Layer 6)

- `resolveTheme` takes `Theme` from `@t3tools/contracts` and returns `ResolvedTheme` — signatures match
- Imports `DARK_DEFAULTS`, `LIGHT_DEFAULTS` from `./defaults` (Step 2)
- Imports `DEFAULT_TYPOGRAPHY_TOKENS`, `DEFAULT_TRANSPARENCY_TOKENS` from `@t3tools/contracts` (Step 1)
- Sparse overrides: `undefined` values in `overrides.colors` must NOT overwrite base defaults

---

## Step 4: CSS Applicator

**Depends on:** Steps 1, 2 (`ResolvedColorTokens`)

### Deliverables

1. `apps/web/src/theme/applicator.ts` (create, ~50 lines)
   - Exports: `colorTokenToCssProperty(tokenName: string): string`, `buildCssPropertyMap(tokens: ResolvedColorTokens): Record<string, string>`, `applyCssTokens(element: HTMLElement, tokens: ResolvedColorTokens): void`, `clearCssTokens(element: HTMLElement, tokens: ResolvedColorTokens): void`

2. `apps/web/src/theme/applicator.test.ts` (create, ~40 lines)

### Test Scenarios (applicator.test.ts)

- `colorTokenToCssProperty("background")` → `"--background"`
- `colorTokenToCssProperty("appChromeBackground")` → `"--app-chrome-background"`
- `colorTokenToCssProperty("terminalBrightRed")` → `"--terminal-bright-red"`
- `buildCssPropertyMap(LIGHT_DEFAULTS)["--background"]` === `LIGHT_DEFAULTS.background`
- `buildCssPropertyMap(LIGHT_DEFAULTS)["--app-chrome-background"]` === `LIGHT_DEFAULTS.appChromeBackground`
- Map entry count equals `Object.keys(LIGHT_DEFAULTS).length` (no dropped tokens)

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/theme/applicator.test.ts
```

### Sentinel Integration Checks (Layer 6)

- `applyCssTokens` and `clearCssTokens` accept `HTMLElement` — no DOM globals used at module load time (safe for SSR/test environments)
- `buildCssPropertyMap` is a pure function (no side effects)
- `colorTokenToCssProperty` never produces `"--"` for an empty string input (edge case: no empty token names in defaults, but must be safe)

---

## Step 5: Terminal Theme Mapper

**Depends on:** Steps 1, 2 (`ResolvedColorTokens`)

### Deliverables

1. `apps/web/src/theme/terminal-mapper.ts` (create, ~45 lines)
   - Exports: `TerminalTheme` (interface — 20 fields matching xterm.js `ITheme`), `buildTerminalTheme(colors: ResolvedColorTokens): TerminalTheme`
   - Does NOT import `@xterm/xterm` — defines its own `TerminalTheme` interface to avoid circular deps

2. `apps/web/src/theme/terminal-mapper.test.ts` (create, ~40 lines)

### Test Scenarios (terminal-mapper.test.ts)

- `buildTerminalTheme(DARK_DEFAULTS)` — all 20 fields map correctly (`background`, `foreground`, `cursor`, `selectionBackground`, 8 basic colors, 8 bright colors)
- `buildTerminalTheme(LIGHT_DEFAULTS).background` === `LIGHT_DEFAULTS.terminalBackground`
- Custom tokens: spread `DARK_DEFAULTS` with `terminalRed: "#ff0000"` → `buildTerminalTheme(custom).red` === `"#ff0000"`

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/theme/terminal-mapper.test.ts
```

### Sentinel Integration Checks (Layer 6)

- `TerminalTheme` interface has exactly 20 fields matching xterm.js `ITheme` shape (background, foreground, cursor, selectionBackground, black, red, green, yellow, blue, magenta, cyan, white + 8 bright variants)
- `buildTerminalTheme` references all 20 `terminal*` fields from `ResolvedColorTokens`
- No import of `@xterm/xterm` or `xterm` in this file

---

## Step 6: ThemeStore

**Depends on:** Steps 1, 2, 3 (`Theme`, `ResolvedTheme`, `ThemeBase`, `ThemeSchema`, `resolveTheme`, `ColorTokens`)

### Deliverables

1. `apps/web/src/theme/store.ts` (create, ~250 lines)
   - Exports: `ThemeStoreSnapshot` (interface — fields: `theme`, `resolved`, `resolvedTheme`, `preference`, `isCustom`, `isDirty`)
   - Exports: `ThemeStore` (class)
     - Public methods: `subscribe(listener: () => void): () => void`, `getSnapshot(): ThemeStoreSnapshot`, `setBase(base: ThemeBase): void`, `setPreference(pref: "light" | "dark" | "system"): void`, `setColorToken(key: keyof ColorTokens, value: string): void`, `resetColorToken(key: keyof ColorTokens): void`, `isColorTokenOverridden(key: keyof ColorTokens): boolean`, `createTheme(name: string, base: ThemeBase): void`, `duplicateTheme(name: string): void`, `deleteTheme(): void`, `selectTheme(id: string): void`, `discardChanges(): void`, `exportTheme(): string`, `importTheme(json: string): void`, `listThemes(): Array<{ id: string; name: string; base: ThemeBase }>`
   - Storage keys: `t3code:theme`, `t3code:custom-themes:v1`, `t3code:active-theme-id:v1`
   - Persistence: debounced 300ms save to localStorage on every mutation

2. `apps/web/src/theme/store.test.ts` (create, ~120 lines)
   - Uses mocked `localStorage` via `Object.defineProperty(globalThis, "localStorage", ...)`

### Test Scenarios (store.test.ts)

- Initializes with dark default when no stored preference
- Initializes with stored `"light"` preference from `localStorage`
- `setBase("light")` → notifies subscriber → snapshot base is `"light"`, background is `LIGHT_DEFAULTS.background`
- `setColorToken("background", "#ff0000")` → `resolved.colors.background` is `"#ff0000"`, other tokens unchanged
- `resetColorToken("background")` after set → resolves back to base default
- `isColorTokenOverridden("background")`: false before set, true after set, false after reset
- `createTheme("My Theme", "dark")` → snapshot name is `"My Theme"`, `isCustom` is `true`, has UUID
- `discardChanges()` after `setColorToken` → reverts to last saved state
- `exportTheme()` → valid JSON with `name`, `base`, `overrides.colors.primary` (for a customized theme)
- `importTheme(json)` → snapshot reflects imported theme, `isCustom` is `true`
- `listThemes()` after two creates → returns at least 4 entries (2 defaults + 2 custom)
- `unsubscribe()` → listener no longer called after `setBase`
- `getSnapshot().resolvedTheme` is `"dark"` for dark base, `"light"` for light base (backwards compat)

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/theme/store.test.ts
```

### Sentinel Integration Checks (Layer 6)

- `ThemeStore` constructor reads from `localStorage` using the three storage keys
- `resolveTheme` from Step 3 is called inside `buildSnapshot` — not re-implemented
- `ThemeSchema` from Step 1 is used in `importTheme` to validate the parsed JSON
- `subscribe` returns an unsubscribe function (not just `void`)
- Debounce timeout is cleared on each new mutation (prevents stale persists)

---

## Step 7: useTheme Rewrite + Theme Barrel + index.html

**Depends on:** Steps 1–6

### Deliverables

1. `apps/web/src/theme/index.ts` (create, ~35 lines)
   - Re-exports: `ThemeStore`, `ThemeStoreSnapshot` from `./store`; `resolveTheme` from `./engine`; `applyCssTokens`, `clearCssTokens`, `colorTokenToCssProperty`, `buildCssPropertyMap` from `./applicator`; `buildTerminalTheme`, `TerminalTheme` from `./terminal-mapper`; `DARK_DEFAULTS`, `LIGHT_DEFAULTS` from `./defaults`
   - Exports: `themeStore` (singleton `ThemeStore` instance, module-level)
   - Side effects on module load: calls `applyThemeToDom()`, subscribes `themeStore` to re-apply on change
   - `applyThemeToDom()` (not exported): toggles `dark` class on `document.documentElement`, calls `applyCssTokens`, sets `backgroundColor` on root and body, updates `<meta name="theme-color">`, calls `window.desktopBridge?.setTheme(resolvedTheme)` if available

2. `apps/web/src/hooks/useTheme.ts` (modify)
   - Removes the hand-rolled store, replaces with `useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getSnapshot)`
   - Return type: `{ theme: "light" | "dark" | "system", setTheme: (t: Theme) => void, resolvedTheme: "light" | "dark", themeSnapshot: ThemeStoreSnapshot }`
   - `setTheme` calls `themeStore.setPreference(t)`
   - `syncBrowserChromeTheme()` function retained for backwards compat (can be a no-op or simple wrapper)

3. `apps/web/index.html` (modify)
   - Pre-hydration `<script>` updated: reads `t3code:active-theme-id:v1` and `t3code:custom-themes:v1` from localStorage to apply custom `appChromeBackground` before React mounts

### Test Scenarios

- Run the full existing `apps/web` Vitest suite — all pre-existing tests must pass
- Grep for `useSyncExternalStore` in `apps/web/src/hooks/useTheme.ts` — must be present
- Grep for `themeStore.subscribe` in `apps/web/src/hooks/useTheme.ts` — must be the first argument to `useSyncExternalStore`

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/
bun run build
```

### Sentinel Integration Checks (Layer 6)

- `themeStore` is the same `ThemeStore` instance used by `useTheme` and the theme editor (singleton, module-level)
- `window.desktopBridge?.setTheme` call uses optional chaining — safe in non-Electron contexts
- Pre-hydration script in `index.html` does NOT import any ES modules — must be a self-contained IIFE
- `useTheme` return shape preserves backwards compatibility: existing consumers using `{ theme, setTheme, resolvedTheme }` continue to work without changes

---

## Step 8: Slider + ColorPicker UI Components

**Depends on:** Step 7 (needs build environment stable before UI work)

### Deliverables

1. `apps/web/src/components/ui/slider.tsx` (create, ~35 lines)
   - Exports: `Slider` component with props `{ value: number, onChange: (v: number) => void, min: number, max: number, step?: number, className?: string, disabled?: boolean }`
   - Uses native `<input type="range">` styled with Tailwind
   - Applies `cn()` utility for class merging

2. `apps/web/src/components/ui/color-picker.tsx` (create, ~80 lines)
   - Exports: `ColorPicker` component with props `{ value: string, onChange: (color: string) => void, className?: string, disabled?: boolean }`
   - Renders: color swatch trigger, popover with native `<input type="color">` + hex text input
   - Uses existing `Popover`, `PopoverTrigger`, `PopoverContent` from `./popover`
   - Accepts any CSS color string (hex, rgb, oklch) — propagates on valid input, reverts on blur if invalid

### Test Scenarios

These are visual components; unit tests are not required. Completion report must include a manual smoke test note confirming:

- Slider renders and `onChange` fires on drag
- ColorPicker swatch opens popover on click
- Hex input updates parent on valid hex entry
- Invalid hex input reverts on blur

### Build/Test Commands

```bash
bun run build
bun run lint
```

### Sentinel Integration Checks (Layer 6)

- `Popover`, `PopoverTrigger`, `PopoverContent` imports resolve from `./popover` (file exists)
- `cn()` utility import resolves from `../../lib/utils`
- No `@xterm/xterm` or theme-engine imports in UI primitives (pure presentation)

---

## Step 9: Appearance Settings Route

**Depends on:** Steps 7, 8

### Deliverables

1. `apps/web/src/routes/settings.appearance.tsx` (create, ~8 lines)
   - Exports: `Route` (TanStack route for path `"/settings/appearance"`, component `AppearanceSettings`)

2. `apps/web/src/components/settings/AppearanceSettings.tsx` (create, ~15 lines)
   - Exports: `AppearanceSettings` (shell component using `SettingsPageContainer`, renders heading + description)

3. `apps/web/src/components/settings/SettingsSidebarNav.tsx` (modify)
   - Adds `{ label: "Appearance", to: "/settings/appearance", icon: PaletteIcon }` to `SETTINGS_NAV_ITEMS`
   - Adds `PaletteIcon` to lucide-react import
   - Updates `SettingsSectionPath` type to include `"/settings/appearance"`

### Test Scenarios

- Grep for `"/settings/appearance"` in `SettingsSidebarNav.tsx` — present in nav items array
- Grep for `SettingsSectionPath` in `SettingsSidebarNav.tsx` — includes `"/settings/appearance"` as a union member
- `bun run build` exits 0 (TanStack Router code-gen picks up the new route)

### Build/Test Commands

```bash
bun run build
bun run --cwd apps/web vitest run src/components/settings/
```

### Sentinel Integration Checks (Layer 6)

- Route file name matches TanStack Router file-based routing convention: `settings.appearance.tsx` → `/settings/appearance`
- `AppearanceSettings` component is the default route component — imported and used in `Route`
- `SettingsPageContainer` import resolves from `./settingsLayout`

---

## Step 10: Theme Editor Header + Tabs

**Depends on:** Steps 7, 8, 9

### Deliverables

1. `apps/web/src/components/settings/ThemeEditorHeader.tsx` (create, ~100 lines)
   - Exports: `ThemeEditorHeader` component
   - Uses: `useTheme()` for `themeSnapshot`, `themeStore.*` for actions (selectTheme, createTheme, duplicateTheme, deleteTheme, exportTheme, importTheme, discardChanges)
   - Renders: theme selector `<Select>`, New/Duplicate/Delete buttons, Import/Export buttons, Discard Changes button (only when `isDirty`)

2. `apps/web/src/components/settings/ThemeEditorTabs.tsx` (create, ~35 lines)
   - Exports: `ThemeEditorTabs` component, `ThemeEditorTab` type (`"colors" | "typography" | "transparency" | "icons"`)

3. `apps/web/src/components/settings/AppearanceSettings.tsx` (modify)
   - Renders `ThemeEditorHeader`, `ThemeEditorTabs`, and conditionally `ColorsPanel` (or placeholder text for other tabs)
   - Uses `useState<ThemeEditorTab>` for active tab

### Test Scenarios

- Grep for `isDirty` in `ThemeEditorHeader.tsx` — conditional render of Discard button
- Grep for `themeStore.selectTheme` in `ThemeEditorHeader.tsx` — wired to Select `onValueChange`
- Grep for `ColorsPanel` in `AppearanceSettings.tsx` — rendered when `activeTab === "colors"`

### Build/Test Commands

```bash
bun run build
bun run lint
```

### Sentinel Integration Checks (Layer 6)

- `Select`, `SelectTrigger`, `SelectValue`, `SelectPopup`, `SelectItem` imports resolve from `../ui/select`
- `Button` import resolves from `../ui/button`
- `themeStore` import resolves from `../../theme` (Step 7 singleton)
- `ThemeEditorTabs` import resolves in `AppearanceSettings.tsx`

---

## Step 11: Colors Panel

**Depends on:** Steps 7, 8, 10

### Deliverables

1. `apps/web/src/components/settings/theme-editor/colorSections.ts` (create, ~120 lines)
   - Exports: `ColorSection` (interface — `{ id: string, title: string, tokens: Array<{ key: keyof ColorTokens, label: string }> }`), `COLOR_SECTIONS: ColorSection[]`
   - Must define 11 sections: App Chrome, Sidebar, Main Content, Primary & Accent, Code Blocks, Terminal (20 tokens), Diff Viewer, Inputs & Composer, Buttons & Controls, Borders, Status Colors
   - Total tokens across all sections: covers all 42 keys in `ColorTokens`

2. `apps/web/src/components/settings/theme-editor/ColorTokenRow.tsx` (create, ~45 lines)
   - Exports: `ColorTokenRow` with props `{ tokenKey: keyof ColorTokens, label: string }`
   - Uses: `useTheme()` for `themeSnapshot.resolved.colors[tokenKey]`, `themeStore.isColorTokenOverridden(tokenKey)`, `themeStore.setColorToken(tokenKey, color)`, `themeStore.resetColorToken(tokenKey)`
   - Renders: label (with override dot if `isOverridden`), `ColorPicker`, reset button (only when overridden)

3. `apps/web/src/components/settings/theme-editor/ColorsPanel.tsx` (create, ~50 lines)
   - Exports: `ColorsPanel` component
   - Renders: all 11 `COLOR_SECTIONS` as collapsible sections, each containing `ColorTokenRow` per token
   - Uses `useState<Set<string>>` for expanded sections (all expanded by default)

### Test Scenarios

- `COLOR_SECTIONS.length` === 11
- Total token count across all sections: grep/count entries, must be 42 (matches `ColorTokensSchema` field count)
- Grep for `themeStore.setColorToken` in `ColorTokenRow.tsx` — present
- Grep for `themeStore.resetColorToken` in `ColorTokenRow.tsx` — present, conditional on `isOverridden`
- Grep for `COLOR_SECTIONS` in `ColorsPanel.tsx` — mapped over

### Build/Test Commands

```bash
bun run build
bun run lint
```

### Sentinel Integration Checks (Layer 6)

- `ColorPicker` import resolves from `../../ui/color-picker` (Step 8)
- `themeStore` import resolves from `../../../theme` (Step 7 singleton)
- `useTheme` import resolves from `../../../hooks/useTheme` (Step 7 rewrite)
- `ColorsPanel` is imported in `AppearanceSettings.tsx` (Step 10)
- Every key in `COLOR_SECTIONS[*].tokens[*].key` is a valid `keyof ColorTokens` — TypeScript must accept without errors

---

## Step 12: Wire Terminal Theme Consumer

**Depends on:** Steps 5, 7 (`buildTerminalTheme`, `themeStore`)

### Deliverables

1. `apps/web/src/components/ThreadTerminalDrawer.tsx` (modify)
   - Adds imports: `themeStore`, `buildTerminalTheme` from `"../theme"`
   - Replaces `terminalThemeFromApp()` body with: `return buildTerminalTheme(themeStore.getSnapshot().resolved.colors)`
   - Removes: hardcoded dark/light ANSI color objects, `normalizeComputedColor` helper (if unused elsewhere in the file)

### Test Scenarios

- Grep for `buildTerminalTheme` in `ThreadTerminalDrawer.tsx` — present in `terminalThemeFromApp`
- Grep for `themeStore` in `ThreadTerminalDrawer.tsx` — imported and used
- Grep for the old hardcoded palette colors (e.g., `"rgb(255, 122, 142)"`) — must NOT be present
- Run existing tests: `bun run --cwd apps/web vitest run src/components/ThreadTerminalDrawer` — PASS

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/components/ThreadTerminalDrawer
bun run build
```

### Sentinel Integration Checks (Layer 6)

- `terminalThemeFromApp()` return type matches the xterm.js `ITheme` shape expected by the terminal instance
- `themeStore.getSnapshot().resolved.colors` provides all 20 terminal color tokens needed by `buildTerminalTheme`
- No remaining hardcoded ANSI palette constants in the file

---

## Step 13: Wire Composer Theme Consumer

**Depends on:** Step 7 (`themeStore`)

### Deliverables

1. `apps/web/src/components/ComposerPromptEditor.tsx` (modify)
   - Adds import: `themeStore` from `"../theme"`
   - Replaces `resolvedThemeFromDocument()` body with: `return themeStore.getSnapshot().resolvedTheme`
   - Removes: DOM class check logic (`document.documentElement.classList.contains("dark")`)

### Test Scenarios

- Grep for `themeStore.getSnapshot` in `ComposerPromptEditor.tsx` — present in `resolvedThemeFromDocument`
- Grep for `classList.contains("dark")` in `ComposerPromptEditor.tsx` — must NOT be present
- Run existing tests: `bun run --cwd apps/web vitest run src/components/ComposerPromptEditor` — PASS

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/components/ComposerPromptEditor
bun run build
```

### Sentinel Integration Checks (Layer 6)

- `resolvedThemeFromDocument` return type is `"light" | "dark"` — matches `themeStore.getSnapshot().resolvedTheme`
- No test mocks reference the old DOM class check (if any existing tests mocked `classList`, they must be updated)

---

## Step 14: Remove Old Theme UI from General Settings

**Depends on:** Step 9 (Appearance route must exist before removing the control)

### Deliverables

1. `apps/web/src/components/settings/SettingsPanels.tsx` (modify)
   - Removes: `THEME_OPTIONS` constant, the theme `<Select>` control and its `SettingsRow`
   - Adds: replacement `SettingsRow` with a `Button` that navigates to `/settings/appearance`
   - Adds import: `useNavigate` from `@tanstack/react-router` (if not already imported)
   - Removes or updates: `useSettingsRestore` theme-specific restore logic (theme store manages its own defaults)

### Test Scenarios

- Grep for `THEME_OPTIONS` in `SettingsPanels.tsx` — must NOT be present
- Grep for `"/settings/appearance"` in `SettingsPanels.tsx` — present in navigate call
- Run existing settings tests: `bun run --cwd apps/web vitest run src/components/settings/` — PASS (update any tests that checked for the theme Select)

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/components/settings/
bun run build
```

### Sentinel Integration Checks (Layer 6)

- `useNavigate` from `@tanstack/react-router` resolves correctly
- The replace button navigates to an existing route (`/settings/appearance` — created in Step 9)
- No orphaned imports after removing `THEME_OPTIONS` (lint clean)

---

## Step 15: Integration Tests

**Depends on:** Steps 1–14 (all theme engine components)

### Deliverables

1. `apps/web/src/theme/integration.test.ts` (create, ~80 lines)
   - Uses mocked `localStorage` (same pattern as `store.test.ts`)
   - Tests cross-module interactions

### Test Scenarios (integration.test.ts)

- **Full lifecycle**: create theme → customize 3 color tokens → export JSON → import into fresh store → verify colors match, sparse tokens absent from JSON
- **Terminal mapper end-to-end**: create theme → set `terminalRed` and `terminalGreen` → `buildTerminalTheme(resolved.colors)` returns custom red and green, non-overridden `terminalBlue` uses `DARK_DEFAULTS.terminalBlue`
- **CSS map end-to-end**: create light theme → set `background` → `buildCssPropertyMap(resolved.colors)["--background"]` is custom value, `["--foreground"]` is `LIGHT_DEFAULTS.foreground`
- **Per-theme isolation**: create Theme A (dark, custom background) → create Theme B (light, custom background) → `selectTheme(idA)` → background reverts to Theme A's custom value

### Build/Test Commands

```bash
bun run --cwd apps/web vitest run src/theme/integration.test.ts
bun run test
```

### Sentinel Integration Checks (Layer 6)

- Tests import `ThemeStore` from `./store`, `buildTerminalTheme` from `./terminal-mapper`, `buildCssPropertyMap` from `./applicator`, `DARK_DEFAULTS`, `LIGHT_DEFAULTS` from `./defaults` — all resolve
- No test uses `themeStore` singleton (tests create their own isolated `new ThemeStore()` instances)
- All 4 integration tests exercise at least 2 separate modules from prior steps

---

## Step 16: Lint, Format, and Build Verification

**Depends on:** Steps 1–15

### Deliverables

No new files. This is a verification-only checkpoint.

### Verification Checklist

- `bun run lint` exits 0 — no OXLint errors in any new or modified file
- `bun run fmt:check` exits 0 — all files pass OXFmt
- `bun run build` exits 0 — no TypeScript errors across all packages
- `bun run test` exits 0 — full Vitest suite passes, no skipped tests on theme files

### Build/Test Commands

```bash
bun run lint
bun run fmt:check
bun run build
bun run test
```

### Sentinel Spec Conformance Check (Layer 5)

- No hardcoded ANSI color values remain in `ThreadTerminalDrawer.tsx`
- No DOM class check (`classList.contains("dark")`) remains in `ComposerPromptEditor.tsx`
- No `THEME_OPTIONS` remains in `SettingsPanels.tsx`
- `apps/web/src/index.css` retains its default token definitions (fallback if engine fails) but the engine overrides them via inline styles

---

## Final Sweep Criteria

After all 16 checkpoints pass, Sentinel runs the final sweep:

### 1. Plan Coverage

Verify all 16 steps received a checkpoint and passed. Steps dispatched but unreported are escalated.

### 2. Stub Sweep (project-wide)

```bash
grep -rn 'TODO\|FIXME\|HACK' apps/web/src/theme/ apps/web/src/components/settings/theme-editor/ packages/contracts/src/theme.ts
```

Zero results expected.

### 3. Build from Clean

```bash
bun run build && bun run test
```

Both must exit 0.

### 4. Integration Smoke Test

Trace the end-to-end color customization path:

1. `ThemeEditorHeader` → user selects theme → `themeStore.selectTheme(id)` ✓
2. `ColorTokenRow` → user picks color → `themeStore.setColorToken(key, value)` ✓
3. `ThemeStore.setColorToken` → `resolveTheme(theme)` → `ThemeStoreSnapshot.resolved.colors` ✓
4. `themeStore.subscribe` → `applyThemeToDom()` → `applyCssTokens(document.documentElement, resolved.colors)` ✓
5. `buildTerminalTheme(resolved.colors)` used in `ThreadTerminalDrawer.terminalThemeFromApp()` ✓

Every link must have a real implementation — verify with Grep + Read.

### 5. Dead Code

Check for orphaned files in `apps/web/src/theme/` and `apps/web/src/components/settings/theme-editor/` not imported anywhere.

### 6. Documentation Drift

The design doc (`2026-04-14-theme-engine-design.md`) describes a `DesktopBridge` extension for opacity/vibrancy — this is Phase 3 scope, not Phase 1. Confirm the implementation correctly defers those features (the design doc covers all phases; Phase 1 scope is color-only).
