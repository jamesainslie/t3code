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

interface HastNode {
  type?: string;
  tagName?: string;
  position?: { start?: { line?: number }; end?: { line?: number } };
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const SOURCE_LINE_BLOCK_TAGS = new Set([
  "blockquote",
  "dd",
  "dt",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "pre",
  "table",
  "td",
  "th",
  "tr",
]);

/**
 * Stamps each rendered block with the source lines it came from, so a selection
 * in the rendered document can name the lines it quotes. Runs after sanitizing,
 * which keeps positions but would strip the attributes.
 */
export function rehypeSourceLines() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      const start = node.position?.start?.line;
      const end = node.position?.end?.line;
      if (
        node.type === "element" &&
        node.tagName &&
        SOURCE_LINE_BLOCK_TAGS.has(node.tagName) &&
        start !== undefined &&
        end !== undefined
      ) {
        node.properties = { ...node.properties, dataSourceStart: start, dataSourceEnd: end };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export interface SourceLineSpan {
  readonly start: number;
  readonly end: number;
}

/** The source lines covered from one stamped block to another, in either order. */
export function sourceLinesBetween(
  first: SourceLineSpan | null,
  last: SourceLineSpan | null,
): { startLine: number; endLine: number } | null {
  const spans = [first, last].filter((span): span is SourceLineSpan => span !== null);
  if (spans.length === 0) return null;
  return {
    startLine: Math.min(...spans.map((span) => span.start)),
    endLine: Math.max(...spans.map((span) => span.end)),
  };
}

/** Reads the source lines of the stamped block around a DOM node. */
export function sourceLineSpanAt(node: Node): SourceLineSpan | null {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const block = element?.closest<HTMLElement>("[data-source-start]");
  const start = Number(block?.dataset.sourceStart);
  const end = Number(block?.dataset.sourceEnd);
  return Number.isInteger(start) && Number.isInteger(end) && start > 0 ? { start, end } : null;
}
