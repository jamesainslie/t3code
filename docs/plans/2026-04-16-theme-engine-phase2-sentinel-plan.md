# Theme Engine Phase 2: Typography — Sentinel Execution Plan

**Date:** 2026-04-16
**Status:** Ready to execute
**Sentinel protocol:** Active

## Parallelism Map

Steps 1, 2 can execute in parallel (no shared files). Step 3 depends on Step 2. Step 4 depends on Step 1. Step 5 depends on Step 4. Step 6 depends on Steps 2+5. Step 7 depends on all. Step 8 is verification.

## Steps

1. Add typography token methods to ThemeStore (store.ts, store.test.ts)
2. Extend CSS applicator for typography tokens (applicator.ts, applicator.test.ts)
3. Extend applyThemeToDom for typography (theme/index.ts) — depends on Step 2
4. Build TypographyPanel UI (TypographyPanel.tsx, TypographyTokenRow.tsx, FontSizeControl.tsx, LineHeightControl.tsx) — depends on Step 1
5. Wire TypographyPanel into AppearanceSettings — depends on Step 4
6. Wire typography CSS vars into index.css — depends on Steps 2+5
7. Integration tests — depends on all
8. Lint + build verification
