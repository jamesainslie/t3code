import { Atom } from "effect/unstable/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import type {
  EnvironmentId,
  ProjectFileChangeEvent,
  ProjectFileEntry,
} from "@t3tools/contracts";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentApi } from "../environmentApi";

// ── Types ──────────────────────────────────────────────────────────────

export interface DocsFileState {
  readonly files: readonly ProjectFileEntry[];
  readonly isPending: boolean;
}

export const INITIAL_DOCS_FILE_STATE: DocsFileState = {
  files: [],
  isPending: true,
};

// ── Reducer ────────────────────────────────────────────────────────────

export function applyFileChangeEvent(
  state: DocsFileState,
  event: ProjectFileChangeEvent,
): DocsFileState {
  switch (event._tag) {
    case "snapshot":
      return { files: event.files, isPending: false };
    case "added":
      return {
        ...state,
        files: [
          ...state.files,
          {
            relativePath: event.relativePath,
            size: event.size,
            mtimeMs: event.mtimeMs,
            oversized: false,
          },
        ],
      };
    case "changed":
      return {
        ...state,
        files: state.files.map((f) =>
          f.relativePath === event.relativePath
            ? { ...f, size: event.size, mtimeMs: event.mtimeMs }
            : f,
        ),
      };
    case "removed":
      return {
        ...state,
        files: state.files.filter((f) => f.relativePath !== event.relativePath),
      };
    case "turnTouchedDoc":
      return state;
  }
}

// ── Atom Family ────────────────────────────────────────────────────────

const docsFileStateAtom = Atom.family((key: string) =>
  Atom.make(INITIAL_DOCS_FILE_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`docs-file-state:${key}`),
  ),
);

const EMPTY_ATOM = Atom.make(INITIAL_DOCS_FILE_STATE);

function getDocsFileKey(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): string | null {
  return environmentId && cwd ? `${environmentId}:${cwd}` : null;
}

// ── Subscription Management ────────────────────────────────────────────

const activeSubscriptions = new Map<string, { refCount: number; unsubscribe: () => void }>();

function subscribeToFileChanges(
  key: string,
  environmentId: EnvironmentId,
  cwd: string,
): () => void {
  const existing = activeSubscriptions.get(key);
  if (existing) {
    existing.refCount++;
    return () => {
      existing.refCount--;
      if (existing.refCount <= 0) {
        existing.unsubscribe();
        activeSubscriptions.delete(key);
      }
    };
  }

  const api = readEnvironmentApi(environmentId);
  if (!api) return () => {};

  appAtomRegistry.set(docsFileStateAtom(key), { ...INITIAL_DOCS_FILE_STATE });

  const unsubscribe = api.projectFiles.onFileChange(
    { cwd, globs: ["**/*.md"], ignoreGlobs: [] },
    (event: ProjectFileChangeEvent) => {
      const current = appAtomRegistry.get(docsFileStateAtom(key));
      const next = applyFileChangeEvent(current, event);
      if (next !== current) {
        appAtomRegistry.set(docsFileStateAtom(key), next);
      }
    },
    {
      onResubscribe: () => {
        appAtomRegistry.set(docsFileStateAtom(key), { ...INITIAL_DOCS_FILE_STATE });
      },
    },
  );

  activeSubscriptions.set(key, { refCount: 1, unsubscribe });

  return () => {
    const entry = activeSubscriptions.get(key);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      entry.unsubscribe();
      activeSubscriptions.delete(key);
    }
  };
}

// ── React Hook ─────────────────────────────────────────────────────────

export interface DocsFileTarget {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}

export function useDocsFileState(target: DocsFileTarget): DocsFileState {
  const key = getDocsFileKey(target.environmentId, target.cwd);

  useEffect(() => {
    if (!key || !target.environmentId || !target.cwd) return;
    return subscribeToFileChanges(key, target.environmentId, target.cwd);
  }, [key, target.environmentId, target.cwd]);

  return useAtomValue(key !== null ? docsFileStateAtom(key) : EMPTY_ATOM);
}
