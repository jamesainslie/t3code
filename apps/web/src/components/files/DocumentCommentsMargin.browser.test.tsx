import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DocumentCommentEditor } from "./DocumentCommentsMargin";

describe("DocumentCommentEditor", () => {
  it("takes focus on mount without scrolling the document", async () => {
    await using screen = await render(
      <div data-testid="document" style={{ height: 200, overflow: "auto" }}>
        <div style={{ height: 2_000 }} />
        <DocumentCommentEditor
          label="L12"
          initialBody=""
          submitLabel="Comment"
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      </div>,
    );

    await expect.element(page.getByRole("textbox", { name: "Comment" })).toHaveFocus();
    // A scrolling focus is what threw the viewport to the top of the file.
    expect(screen.getByTestId("document").element().scrollTop).toBe(0);
  });
});
