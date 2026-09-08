import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);

export function mermaidRepairPrompt(source: string, error: string): string {
  const longestFence = Math.max(2, ...[...source.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return `Please correct this Mermaid diagram while preserving its meaning. Reply with the corrected Mermaid code block.\n\nRenderer error:\n${error}\n\nOriginal diagram:\n${fence}mermaid\n${source}\n${fence}`;
}

type MermaidPart =
  | { kind: "markdown"; sourceOffset: number; markdown: string }
  | { kind: "mermaid"; sourceOffset: number; source: string; complete: boolean };

/** The AST's code range includes its closing fence, even inside lists and quotes. */
export function isMermaidFenceComplete(raw: string, code: string): boolean {
  const lines = raw.trimEnd().split(/\r?\n/);
  const opening = lines[0]?.match(/^\s*(`{3,}|~{3,})/);
  if (!opening || lines.length < 2) return false;
  const fence = opening[1]!;
  const closing = lines.at(-1)?.replace(/^[\s>]*/, "") ?? "";
  const closingPattern = new RegExp(`^${fence[0]}{${fence.length},}\\s*$`);
  // An unrecognized closing marker remains in the parser's code body.
  return (
    closingPattern.test(closing) &&
    !closingPattern.test(code.trimEnd().split(/\r?\n/).at(-1)?.trim() ?? "")
  );
}

export function splitMermaidMarkdown(markdown: string): MermaidPart[] {
  if (!/mermaid/i.test(markdown))
    return markdown ? [{ kind: "markdown", sourceOffset: 0, markdown }] : [];
  const parts: MermaidPart[] = [];
  let offset = 0;
  const tree = parser.parse(markdown);
  function visit(node: (typeof tree)["children"][number]) {
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      if (start > offset)
        parts.push({
          kind: "markdown",
          sourceOffset: offset,
          markdown: markdown.slice(offset, start),
        });
      parts.push({
        kind: "mermaid",
        sourceOffset: start,
        source: node.value,
        complete: isMermaidFenceComplete(markdown.slice(start, end), node.value),
      });
      offset = end;
    } else if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  }
  for (const node of tree.children) visit(node);
  if (offset < markdown.length)
    parts.push({ kind: "markdown", sourceOffset: offset, markdown: markdown.slice(offset) });
  return parts;
}
