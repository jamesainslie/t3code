import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { DocumentCommentEditor } from "./DocumentCommentsMargin";

describe("DocumentCommentEditor", () => {
  it("takes focus on mount without scrolling the document", async () => {
    const focus = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          <DocumentCommentEditor
            label="L12"
            initialBody=""
            submitLabel="Comment"
            onSubmit={() => {}}
            onCancel={() => {}}
          />,
          { createNodeMock: (element) => (element.type === "textarea" ? { focus } : null) },
        );
      });
      const textarea = renderer!.root.findByType("textarea");
      // A scrolling focus is what threw the viewport to the top of the file.
      expect(textarea.props.autoFocus).toBeFalsy();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
