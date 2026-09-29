/**
 * Chat math (fork feature). Agents write TeX as `$…$`, `$$…$$`, `\(…\)` and
 * `\[…\]`, but chat is also full of prices and shell variables. Before the
 * markdown parse, this rewrites every formula into the only two forms
 * `remark-math` reads with single dollars off: inline `$$…$$` and a `$$` block.
 *
 * - `$…$` counts as math only under Pandoc's rule: no space just inside either
 *   dollar, and no digit right after the closing one. `$5 and $10` stays text.
 * - `\(…\)` and `\[…\]` must be rewritten here, since markdown reads their
 *   backslashes as escapes and drops them.
 * - Code spans and fenced code are copied untouched.
 * - A display block still open at the end (a streaming reply) becomes a TeX
 *   code block, so it cannot swallow the rest of the message.
 */
export function normalizeChatMath(markdown: string): string {
  if (!/[$\\]/.test(markdown)) return markdown;

  const lines = markdown.split("\n");
  const output: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  let openMath: { closer: string; prefix: string; outputIndex: number } | null = null;

  for (const line of lines) {
    const { prefix, body } = splitLinePrefix(line);
    const trimmed = body.trim();

    if (fence) {
      output.push(line);
      if (closesFence(trimmed, fence)) fence = null;
      continue;
    }
    if (openMath) {
      if (trimmed === openMath.closer) {
        output.push(`${prefix}$$`);
        openMath = null;
      } else {
        output.push(line);
      }
      continue;
    }

    const fenceOpen = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fenceOpen) {
      fence = { marker: fenceOpen[0]!, length: fenceOpen.length };
      output.push(line);
      continue;
    }
    if (trimmed === "$$" || trimmed === "\\[") {
      openMath = { closer: trimmed === "$$" ? "$$" : "\\]", prefix, outputIndex: output.length };
      output.push(`${prefix}$$`);
      continue;
    }

    const standalone = standaloneDisplayMath(trimmed);
    if (standalone !== null) {
      const blank = prefix.trimEnd();
      output.push(blank, `${prefix}$$`, `${prefix}${standalone}`, `${prefix}$$`, blank);
      continue;
    }

    output.push(prefix + normalizeInlineMath(body));
  }

  if (openMath) output[openMath.outputIndex] = `${openMath.prefix}\`\`\`tex`;
  return output.join("\n");
}

/** Indentation and blockquote markers, which a display block must repeat. */
function splitLinePrefix(line: string): { prefix: string; body: string } {
  const prefix = /^[ \t]*(?:>[ \t]?)*/.exec(line)?.[0] ?? "";
  return { prefix, body: line.slice(prefix.length) };
}

function closesFence(trimmed: string, fence: { marker: string; length: number }): boolean {
  const run = /^(`+|~+)$/.exec(trimmed)?.[1];
  return run !== undefined && run[0] === fence.marker && run.length >= fence.length;
}

/** TeX of a line that holds nothing but `\[…\]` or `$$…$$`, else null. */
function standaloneDisplayMath(trimmed: string): string | null {
  const bracket = /^\\\[(.+)\\\]$/.exec(trimmed)?.[1];
  if (bracket !== undefined && !bracket.includes("\\]")) return bracket.trim();
  const dollars = /^\$\$(.+)\$\$$/.exec(trimmed)?.[1];
  if (dollars !== undefined && !dollars.includes("$$")) return dollars.trim();
  return null;
}

function normalizeInlineMath(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;

    if (char === "`") {
      const run = /^`+/.exec(text.slice(index))![0];
      const close = findBacktickRun(text, index + run.length, run.length);
      const end = close === -1 ? index + run.length : close + run.length;
      result += text.slice(index, end);
      index = end;
      continue;
    }

    if (char === "\\") {
      const next = text[index + 1];
      const closer = next === "(" ? "\\)" : next === "[" ? "\\]" : null;
      const close = closer ? findUnescaped(text, closer, index + 2) : -1;
      if (closer && close !== -1) {
        const tex = text.slice(index + 2, close);
        result += next === "[" ? `$$\\displaystyle ${tex.trim()}$$` : `$$${tex}$$`;
        index = close + 2;
      } else {
        // Keep an escape pair whole so `\$` and `\\` never become delimiters.
        result += text.slice(index, index + 2);
        index += 2;
      }
      continue;
    }

    if (char === "$" && text[index + 1] === "$") {
      const close = findUnescaped(text, "$$", index + 2);
      const end = close === -1 ? index + 2 : close + 2;
      result += text.slice(index, end);
      index = end;
      continue;
    }

    if (char === "$") {
      const close = findPandocClosingDollar(text, index);
      if (close !== -1) {
        result += `$$${text.slice(index + 1, close)}$$`;
        index = close + 1;
        continue;
      }
    }

    result += char;
    index += 1;
  }
  return result;
}

function findBacktickRun(text: string, from: number, length: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] !== "`") continue;
    const run = /^`+/.exec(text.slice(index))![0];
    if (run.length === length) return index;
    index += run.length - 1;
  }
  return -1;
}

function findUnescaped(text: string, needle: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] === "\\" && !needle.startsWith("\\")) {
      index += 1;
      continue;
    }
    if (text.startsWith(needle, index)) return index;
    if (text[index] === "\\") index += 1;
  }
  return -1;
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/** Index of the `$` closing the one at `open` under Pandoc's rule, or -1. */
function findPandocClosingDollar(text: string, open: number): number {
  const first = text[open + 1];
  if (isSpace(first) || first === "$") return -1;
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char !== "$") continue;
    const after = text[index + 1];
    if (!isSpace(text[index - 1]) && !(after !== undefined && /[0-9$]/.test(after))) {
      return index;
    }
  }
  return -1;
}
