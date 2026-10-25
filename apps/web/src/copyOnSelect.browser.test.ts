import { describe, expect, it } from "vite-plus/test";

import { createSelectionCopier, shouldCopySelection } from "./copyOnSelect";

function select(node: Node, start: number, end: number) {
  const selection = document.getSelection()!;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

/** Fills the page with `html`, clearing it and the selection on dispose. */
function fillPage(html: string): Disposable {
  document.body.innerHTML = html;
  return {
    [Symbol.dispose]: () => {
      document.getSelection()?.removeAllRanges();
      document.body.innerHTML = "";
    },
  };
}

describe("createSelectionCopier", () => {
  it("copies a selection once, so a later shortcut's clipboard write survives", () => {
    using _page = fillPage("<p>Worked for 3m 12s</p>");
    const text = document.querySelector("p")!.firstChild!;
    const copier = createSelectionCopier();

    expect(copier(select(text, 0, 6), document.body)).toBe(true);
    expect(copier(document.getSelection(), document.body)).toBe(false);
    expect(copier(select(text, 0, 6), document.body)).toBe(false);
    expect(copier(select(text, 7, 10), document.body)).toBe(true);
  });
});

describe("shouldCopySelection", () => {
  it("copies text selected in the page", () => {
    using _page = fillPage("<p>Worked for 3m 12s</p>");
    const text = document.querySelector("p")!.firstChild!;
    expect(shouldCopySelection(select(text, 0, 6), document.body)).toBe(true);
  });

  it("ignores a click that leaves nothing selected", () => {
    using _page = fillPage("<p>Worked</p>");
    const text = document.querySelector("p")!.firstChild!;
    expect(shouldCopySelection(select(text, 2, 2), document.body)).toBe(false);
    expect(shouldCopySelection(null, document.body)).toBe(false);
  });

  it("ignores text selected while editing, so a selection can be pasted over", () => {
    using _page = fillPage('<div contenteditable="true"><p>draft prompt</p></div><input />');
    const draft = document.querySelector("p")!.firstChild!;
    expect(shouldCopySelection(select(draft, 0, 5), document.body)).toBe(false);

    document.body.innerHTML = "<p>page text</p><textarea>note</textarea>";
    const page = document.querySelector("p")!.firstChild!;
    const textarea = document.querySelector("textarea")!;
    expect(shouldCopySelection(select(page, 0, 4), textarea)).toBe(false);
  });
});
