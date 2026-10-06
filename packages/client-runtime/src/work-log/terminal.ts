import type { CommandDisplayMode } from "@t3tools/contracts";

/**
 * Fork: terminal cards for command rows, ported from horde. Commands render as
 * a small terminal (prompt, ANSI-colored output, exit badge) on web and mobile,
 * and copy as a plain transcript that can be pasted into another agent.
 */

/** A 0-255 xterm palette index, or a `#rrggbb` truecolor. */
export type TerminalColor = number | string;

export interface TerminalStyle {
  readonly fg?: TerminalColor;
  readonly bg?: TerminalColor;
  readonly bold?: true;
  readonly dim?: true;
  readonly italic?: true;
  readonly underline?: true;
}

export interface TerminalSegment {
  readonly text: string;
  readonly style: TerminalStyle;
}

type MutableStyle = { -readonly [K in keyof TerminalStyle]: TerminalStyle[K] };

const ESC = "\u001b";

function hex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

/** Reads a `38;5;n` or `38;2;r;g;b` color starting after the 38/48. */
function extendedColor(
  params: ReadonlyArray<number>,
  index: number,
): { color: TerminalColor | undefined; consumed: number } {
  if (params[index] === 5 && params[index + 1] !== undefined) {
    return { color: params[index + 1]! & 255, consumed: 2 };
  }
  if (params[index] === 2 && params[index + 3] !== undefined) {
    const [r, g, b] = [params[index + 1]!, params[index + 2]!, params[index + 3]!];
    return { color: `#${hex(r)}${hex(g)}${hex(b)}`, consumed: 4 };
  }
  return { color: undefined, consumed: 0 };
}

function applySgr(style: MutableStyle, rawParams: string): MutableStyle {
  const params = rawParams === "" ? [0] : rawParams.split(/[;:]/).map((p) => Number(p) || 0);
  let next: MutableStyle = { ...style };
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index]!;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = code - 40;
    else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const { color, consumed } = extendedColor(params, index + 1);
      if (color !== undefined) {
        if (code === 38) next.fg = color;
        else next.bg = color;
      }
      index += consumed;
    }
  }
  return next;
}

function sameStyle(a: TerminalStyle, b: TerminalStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline
  );
}

/**
 * Splits command output into styled runs. Keeps SGR colors and attributes,
 * drops every other escape and control sequence, and collapses carriage-return
 * progress lines to their last frame, roughly what a terminal would show.
 */
export function parseTerminalText(text: string): TerminalSegment[] {
  const segments: Array<{ text: string; style: TerminalStyle }> = [];
  let style: MutableStyle = {};
  let pending = "";

  const flush = () => {
    if (pending === "") return;
    const last = segments.at(-1);
    if (last && sameStyle(last.style, style)) last.text += pending;
    else segments.push({ text: pending, style });
    pending = "";
  };
  // A lone carriage return rewrites the current line from its start.
  const eraseLine = () => {
    flush();
    while (segments.length > 0) {
      const last = segments.at(-1)!;
      const newline = last.text.lastIndexOf("\n");
      if (newline >= 0) {
        last.text = last.text.slice(0, newline + 1);
        return;
      }
      segments.pop();
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === ESC) {
      const kind = text[index + 1];
      if (kind === "[") {
        let end = index + 2;
        while (end < text.length && !/[@-~]/.test(text[end]!)) end += 1;
        if (text[end] === "m") {
          flush();
          style = applySgr(style, text.slice(index + 2, end));
        }
        index = end;
      } else if (kind === "]") {
        let end = index + 2;
        while (end < text.length && text[end] !== "\u0007" && text[end] !== ESC) end += 1;
        index = text[end] === ESC ? end + 1 : end;
      } else if (kind === "(" || kind === ")") {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (char === "\r") {
      if (text[index + 1] !== "\n") eraseLine();
      continue;
    }
    if (char !== "\n" && char !== "\t" && char < " ") continue;
    pending += char;
  }
  flush();
  return segments.filter((segment) => segment.text !== "");
}

/** The visible text of command output, without colors or control sequences. */
export function stripTerminalControl(text: string): string {
  return parseTerminalText(text)
    .map((segment) => segment.text)
    .join("");
}

/**
 * A command and its result as a plain shell transcript, for pasting into an
 * agent or another tool: `$ command`, the output, and `[exit N]` on failure.
 */
export function terminalTranscript(input: {
  readonly command: string;
  readonly output: string | null | undefined;
  readonly exitCode?: number | undefined;
}): string {
  const lines = input.command
    .trim()
    .split("\n")
    .map((line, index) => `${index === 0 ? "$" : ">"} ${line}`);
  const output = input.output ? stripTerminalControl(input.output).replace(/\s+$/, "") : "";
  if (output) lines.push(output);
  if (input.exitCode !== undefined && input.exitCode !== 0) lines.push(`[exit ${input.exitCode}]`);
  return lines.join("\n");
}

/** Whether a command row opens on its own: always when exposed, on failure otherwise. */
export function commandStartsExpanded(mode: CommandDisplayMode, failed: boolean): boolean {
  return mode === "exposed" || failed;
}

/** VS Code's terminal palette, readable on the app's own background. */
export const TERMINAL_PALETTE = {
  dark: [
    "#000000",
    "#cd3131",
    "#0dbc79",
    "#e5e510",
    "#2472c8",
    "#bc3fbc",
    "#11a8cd",
    "#e5e5e5",
    "#666666",
    "#f14c4c",
    "#23d18b",
    "#f5f543",
    "#3b8eea",
    "#d670d6",
    "#29b8db",
    "#e5e5e5",
  ],
  light: [
    "#000000",
    "#cd3131",
    "#00bc00",
    "#949800",
    "#0451a5",
    "#bc05bc",
    "#0598bc",
    "#555555",
    "#666666",
    "#cd3131",
    "#14ce14",
    "#b5ba00",
    "#0451a5",
    "#bc05bc",
    "#0598bc",
    "#a5a5a5",
  ],
} as const satisfies Record<"dark" | "light", ReadonlyArray<string>>;

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

/** Resolves a segment color to CSS hex using the 16-color theme palette. */
export function terminalColorHex(
  color: TerminalColor,
  palette: ReadonlyArray<string> = TERMINAL_PALETTE.dark,
): string {
  if (typeof color === "string") return color;
  if (color < 16) return palette[color] ?? palette[7]!;
  if (color < 232) {
    const cube = color - 16;
    const r = CUBE_STEPS[Math.floor(cube / 36)]!;
    const g = CUBE_STEPS[Math.floor(cube / 6) % 6]!;
    const b = CUBE_STEPS[cube % 6]!;
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const gray = 8 + (color - 232) * 10;
  return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}
