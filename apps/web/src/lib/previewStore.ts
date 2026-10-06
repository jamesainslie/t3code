/**
 * A transient, unsaved value that pickers show while the user browses options. Setting a
 * value waits `delayMs` so holding an arrow key does not repaint every step; `null` clears
 * at once, for when the picker closes or selects.
 */
export function createPreviewStore<T>(delayMs: number) {
  let preview: T | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const setPreview = (next: T | null) => {
    if (next === preview) return;
    preview = next;
    for (const listener of listeners) listener();
  };

  return {
    preview(value: T | null): void {
      clearTimeout(pending);
      pending = undefined;
      if (value === null) {
        setPreview(null);
        return;
      }
      pending = setTimeout(() => {
        pending = undefined;
        setPreview(value);
      }, delayMs);
    },
    get(): T | null {
      return preview;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
