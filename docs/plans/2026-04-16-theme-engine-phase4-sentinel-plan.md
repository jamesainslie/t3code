# Theme Engine Phase 4: Icon Sets — Sentinel Execution Plan

**Date:** 2026-04-16
**Status:** Ready to execute
**Sentinel protocol:** Active

## Scope

Infrastructure + selection UI only. Does NOT bundle third-party SVG packs or replace existing Lucide references. Builds the registry, preference storage, React hook, and visual selection grid so icon sets can be plugged in later.

## Parallelism Map

Step 1 is foundation. Steps 2+4 depend on Step 1. Step 3 depends on Steps 1+2. Step 5 depends on Steps 2+3+4. Step 6 depends on Steps 2+5. Step 7 depends on Step 6. Step 8 depends on all. Step 9 is verification.

## Steps

1. Icon set manifest types in contracts (theme.ts, theme.test.ts)
2. Icon set registry (icon-registry.ts, icon-registry.test.ts) — depends on Step 1
3. Extend theme engine to resolve icons (engine.ts, engine.test.ts) — depends on Steps 1+2
4. Extend ThemeStore with icon set methods (store.ts, store.test.ts) — depends on Step 1
5. Theme barrel re-exports + useIconSet hook — depends on Steps 2+3+4
6. IconsPanel UI component (IconsPanel.tsx, IconSetCard.tsx) — depends on Steps 2+5
7. Wire IconsPanel into AppearanceSettings — depends on Step 6
8. Integration tests (icon-integration.test.ts) — depends on all
9. Lint + build verification
