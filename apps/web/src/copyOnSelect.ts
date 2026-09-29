import { useEffect } from "react";

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isEditing(node: Node | null): boolean {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest(EDITABLE_SELECTOR) != null;
}

/**
 * Whether a finished selection should go to the clipboard: it holds text and
 * was not made while editing. Selecting in the composer or a field usually
 * means "replace this", and copying it would paste the selection back.
 */
export function shouldCopySelection(
  selection: Selection | null,
  activeElement: Element | null,
): boolean {
  if (!selection || selection.isCollapsed || selection.toString().length === 0) return false;
  return !isEditing(activeElement) && !isEditing(selection.anchorNode);
}

const sameRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset;

/**
 * Decides per finished selection whether to copy it, copying each selection
 * once. Events that end nothing new (a modifier released after a shortcut
 * that wrote its own text to the clipboard) must not put the selection back.
 */
export function createSelectionCopier() {
  let lastCopied: Range | null = null;
  return (selection: Selection | null, activeElement: Element | null): boolean => {
    if (!shouldCopySelection(selection, activeElement)) return false;
    const range = selection!.getRangeAt(0);
    if (lastCopied && sameRange(lastCopied, range)) return false;
    lastCopied = range.cloneRange();
    return true;
  };
}

const SELECTION_ENDING_KEYS = new Set(["Shift", "Meta", "Control"]);

/**
 * Copies text as soon as a selection is finished (fork setting). It goes
 * through the browser's own copy, so the app's copy handlers shape the result
 * exactly as Cmd/Ctrl+C would, and it runs inside the pointer or key event
 * that finished the selection, which the clipboard requires.
 */
export function useCopyOnSelect(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const shouldCopy = createSelectionCopier();
    const copySelection = () => {
      if (shouldCopy(document.getSelection(), document.activeElement)) {
        document.execCommand("copy");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // Keyboard selection ends when Shift is released, and Select All when its
      // modifier is: macOS sends no keyup for "a" while Cmd is held.
      if (SELECTION_ENDING_KEYS.has(event.key) || (event.ctrlKey && event.key === "a")) {
        copySelection();
      }
    };
    document.addEventListener("pointerup", copySelection);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("pointerup", copySelection);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled]);
}
