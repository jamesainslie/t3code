# Theme Engine Phase 3: Electron Transparency — Sentinel Execution Plan

**Date:** 2026-04-16
**Status:** Ready to execute
**Sentinel protocol:** Active

## Parallelism Map

Steps 1, 2 can execute in parallel. Step 3 depends on Step 2. Step 4 depends on Steps 2+3. Step 5 depends on Steps 1+4. Step 6 depends on Steps 1+5. Step 7 depends on Step 6. Steps 8+9 depend on all. Step 10 is verification.

## Steps

1. Add transparency token methods to ThemeStore (store.ts, store.test.ts)
2. Extend DesktopBridge interface (contracts/ipc.ts)
3. Implement IPC handlers in Electron main process (desktop/main.ts, desktopSettings.ts)
4. Extend preload script (desktop/preload.ts) — depends on Steps 2+3
5. Wire transparency into applyThemeToDom (theme/index.ts) — depends on Steps 1+4
6. Build TransparencyPanel UI — depends on Steps 1+5
7. Wire TransparencyPanel into AppearanceSettings — depends on Step 6
8. Integration tests — depends on all
9. Desktop settings persistence test — depends on Step 3
10. Lint + build verification
