import GithubSlugger from "github-slugger";
import { fromMarkdown } from "mdast-util-from-markdown";

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

interface TextTreeNode {
  readonly type?: string;
  readonly value?: unknown;
  readonly children?: ReadonlyArray<TextTreeNode>;
}

function visibleText(node: TextTreeNode): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map(visibleText).join("") ?? "";
}

/**
 * Gives every heading the id GitHub would, so a document's own `#section`
 * links (a table of contents, a "see below") land on the heading they name.
 * The sanitizer later prefixes these with `user-content-`, which the fragment
 * click handler already looks through. A section of a longer document passes
 * the headings before it, so a repeated heading keeps the document's count.
 */
export function remarkHeadingIds(options?: { readonly precedingHeadings?: ReadonlyArray<string> }) {
  return (tree: MarkdownAstNode) => {
    const slugger = new GithubSlugger();
    for (const heading of options?.precedingHeadings ?? []) slugger.slug(heading);
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
 * which keeps positions but would strip the attributes. A section of a longer
 * document passes the document line it starts on.
 */
export function rehypeSourceLines(options?: { readonly firstLine?: number }) {
  const lineOffset = (options?.firstLine ?? 1) - 1;
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
        node.properties = {
          ...node.properties,
          dataSourceStart: start + lineOffset,
          dataSourceEnd: end + lineOffset,
        };
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

/** Documents up to this length render in one pass. */
const WHOLE_DOCUMENT_MAX_LENGTH = 64 * 1024;
/** Longer documents render in sections of about this length, one per task. */
const SECTION_TARGET_LENGTH = 16 * 1024;

const FENCE_REGEX = /^\s*(`{3,}|~{3,})(.*)$/;
const LIST_ITEM_REGEX = /^(?:[-+*]|\d{1,9}[.)])(?:\s|$)/;
const BLOCKQUOTE_MARKERS_REGEX = /^(?: {0,3}>[ \t]?)+/;
const ATX_HEADING_REGEX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const LINK_DEFINITION_REGEX = /^ {0,3}\[(?!\^)(?:[^\]\\]|\\.)+\]:\s*\S/;

export interface MarkdownDocumentSection {
  /** The section's source, followed by the document's link reference definitions. */
  readonly text: string;
  /** Character offset of the section in the document. */
  readonly offset: number;
  /** One-based document line the section starts on. */
  readonly startLine: number;
  /** Visible text of every heading before the section, for `remarkHeadingIds`. */
  readonly precedingHeadings: ReadonlyArray<string>;
}

function atxHeadingText(line: string): string | null {
  const unquoted = line.replace(BLOCKQUOTE_MARKERS_REGEX, "");
  if (!ATX_HEADING_REGEX.test(unquoted)) return null;
  const heading = fromMarkdown(unquoted.trim()).children[0];
  return heading?.type === "heading" ? visibleText(heading) : null;
}

/**
 * Splits a long markdown file into sections that render one at a time, so a
 * large document never blocks the page while it parses. A cut falls only on a
 * blank line before an unindented block, which ends whatever came before it,
 * and never inside a code fence, display math, an HTML comment or `<details>`,
 * nor between list items. Each section repeats the document's one-line link
 * reference definitions, which markdown resolves document-wide. Footnotes and
 * setext headings stay local to their section.
 */
export function splitMarkdownDocument(
  markdown: string,
  { wholeMaxLength = WHOLE_DOCUMENT_MAX_LENGTH, sectionLength = SECTION_TARGET_LENGTH } = {},
): MarkdownDocumentSection[] {
  if (markdown.length <= wholeMaxLength) {
    return [{ text: markdown, offset: 0, startLine: 1, precedingHeadings: [] }];
  }

  const lines = markdown.split("\n");
  const cuts = [{ offset: 0, line: 1, headingCount: 0 }];
  const headings: string[] = [];
  const definitions: string[] = [];
  let fence: { readonly marker: string; readonly length: number } | null = null;
  let inMath = false;
  let inComment = false;
  let detailsDepth = 0;
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    if (
      fence === null &&
      !inMath &&
      !inComment &&
      detailsDepth === 0 &&
      offset - cuts.at(-1)!.offset >= sectionLength &&
      lines[index - 1]?.trim() === "" &&
      /^\S/.test(line) &&
      !LIST_ITEM_REGEX.test(line)
    ) {
      cuts.push({ offset, line: index + 1, headingCount: headings.length });
    }
    offset += line.length + 1;

    const fenceMatch = FENCE_REGEX.exec(line);
    if (fence !== null) {
      const [, marker = "", rest = ""] = fenceMatch ?? [];
      if (marker[0] === fence.marker && marker.length >= fence.length && rest.trim() === "") {
        fence = null;
      }
      continue;
    }
    if (inMath) {
      inMath = line.trim() !== "$$";
      continue;
    }
    if (inComment) {
      inComment = !line.includes("-->");
      continue;
    }
    if (fenceMatch) {
      const [, marker = "", rest = ""] = fenceMatch;
      // A backtick fence's info string cannot hold a backtick; that line is inline code.
      if (marker[0] === "~" || !rest.includes("`")) {
        fence = { marker: marker[0]!, length: marker.length };
        continue;
      }
    }
    const trimmed = line.trim();
    if (trimmed === "$$") {
      inMath = true;
      continue;
    }
    if (/^ {0,3}<!--/.test(line) && !line.slice(line.indexOf("<!--") + 4).includes("-->")) {
      inComment = true;
      continue;
    }
    if (/^ {0,3}<details[\s>]/i.test(line)) detailsDepth += 1;
    if (/<\/details>/i.test(line)) detailsDepth = Math.max(0, detailsDepth - 1);
    const heading = atxHeadingText(line);
    if (heading !== null) headings.push(heading);
    else if (LINK_DEFINITION_REGEX.test(line)) definitions.push(trimmed);
  }

  const sharedDefinitions = definitions.length > 0 ? `\n\n${definitions.join("\n")}\n` : "";
  return cuts.map((cut, index) => ({
    text: markdown.slice(cut.offset, cuts[index + 1]?.offset) + sharedDefinitions,
    offset: cut.offset,
    startLine: cut.line,
    precedingHeadings: headings.slice(0, cut.headingCount),
  }));
}

function sameSection(
  shown: MarkdownDocumentSection | undefined,
  section: MarkdownDocumentSection,
): boolean {
  return (
    shown !== undefined &&
    shown.text === section.text &&
    shown.offset === section.offset &&
    shown.startLine === section.startLine &&
    shown.precedingHeadings.length === section.precedingHeadings.length &&
    shown.precedingHeadings.every((heading, index) => heading === section.precedingHeadings[index])
  );
}

/**
 * One step of bringing the sections on screen up to date with `sections`: the
 * first missing or changed one goes in and any past the end come out. Unchanged
 * sections keep their identity, so their memoized renders survive, and `shown`
 * itself comes back once there is nothing left to do.
 */
export function advanceDocumentSections(
  shown: ReadonlyArray<MarkdownDocumentSection>,
  sections: ReadonlyArray<MarkdownDocumentSection>,
): ReadonlyArray<MarkdownDocumentSection> {
  const index = sections.findIndex((section, i) => !sameSection(shown[i], section));
  if (index === -1) {
    return shown.length === sections.length ? shown : shown.slice(0, sections.length);
  }
  const next = shown.slice(0, sections.length);
  next[index] = sections[index]!;
  return next;
}
