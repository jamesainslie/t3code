import GithubSlugger from "github-slugger";

/**
 * Helpers for rendering a markdown file as a standalone document rather than a
 * chat message. Chat never enables them: a chat message has no table of
 * contents to link into, and `$` there is far more often a price or a shell
 * variable than TeX.
 */

interface MarkdownAstNode {
  type?: string;
  value?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
}

function visibleText(node: MarkdownAstNode): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map(visibleText).join("") ?? "";
}

/**
 * Gives every heading the id GitHub would, so a document's own `#section`
 * links (a table of contents, a "see below") land on the heading they name.
 * The sanitizer later prefixes these with `user-content-`, which the fragment
 * click handler already looks through.
 */
export function remarkHeadingIds() {
  return (tree: MarkdownAstNode) => {
    const slugger = new GithubSlugger();
    const visit = (node: MarkdownAstNode) => {
      if (node.type === "heading") {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, id: slugger.slug(visibleText(node)) },
        };
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const INLINE_CODE_LANGUAGE_REGEX = /^([\s\S]+)\{:([\w#+.-]+)\}$/;

/**
 * Markdown has no syntax for the language of inline code, so documents borrow
 * rehype-pretty-code's trailing marker: `` `const x = 1{:ts}` ``.
 */
export function parseInlineCodeLanguage(
  text: string,
): { readonly code: string; readonly language: string } | null {
  const match = INLINE_CODE_LANGUAGE_REGEX.exec(text);
  if (!match?.[1] || !match[2]) return null;
  return { code: match[1], language: match[2] };
}
