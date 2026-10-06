import { describe, expect, it } from "vite-plus/test";

import {
  commandStartsExpanded,
  parseTerminalText,
  stripTerminalControl,
  TERMINAL_PALETTE,
  terminalColorHex,
  terminalTranscript,
} from "./terminal.ts";

describe("parseTerminalText", () => {
  it("keeps plain text as one unstyled segment", () => {
    expect(parseTerminalText("hello\nworld")).toEqual([{ text: "hello\nworld", style: {} }]);
  });

  it("applies 16-color foregrounds and resets", () => {
    expect(parseTerminalText("\u001b[31mfail\u001b[0m ok")).toEqual([
      { text: "fail", style: { fg: 1 } },
      { text: " ok", style: {} },
    ]);
    expect(parseTerminalText("\u001b[92mpass\u001b[39m")).toEqual([
      { text: "pass", style: { fg: 10 } },
    ]);
  });

  it("combines attributes and turns them off individually", () => {
    expect(parseTerminalText("\u001b[1;4;33mA\u001b[22mB\u001b[24mC")).toEqual([
      { text: "A", style: { fg: 3, bold: true, underline: true } },
      { text: "B", style: { fg: 3, underline: true } },
      { text: "C", style: { fg: 3 } },
    ]);
  });

  it("reads 256-color and truecolor foregrounds and backgrounds", () => {
    expect(parseTerminalText("\u001b[38;5;208mx\u001b[48;2;1;2;255my")).toEqual([
      { text: "x", style: { fg: 208 } },
      { text: "y", style: { fg: 208, bg: "#0102ff" } },
    ]);
  });

  it("drops cursor movement, OSC titles and other control sequences", () => {
    expect(parseTerminalText("\u001b]0;title\u0007a\u001b[2K\u001b[1Gb\u001b(Bc\u0008")).toEqual([
      { text: "abc", style: {} },
    ]);
  });

  it("keeps the last frame of carriage-return progress lines", () => {
    expect(parseTerminalText("10%\r50%\r100%\ndone\r\n")).toEqual([
      { text: "100%\ndone\n", style: {} },
    ]);
  });

  it("treats an empty SGR as a reset", () => {
    expect(parseTerminalText("\u001b[2mdim\u001b[mplain")).toEqual([
      { text: "dim", style: { dim: true } },
      { text: "plain", style: {} },
    ]);
  });
});

describe("stripTerminalControl", () => {
  it("returns the visible text only", () => {
    expect(stripTerminalControl("\u001b[1m\u001b[32m✓\u001b[0m 3 passed\r\n")).toBe("✓ 3 passed\n");
  });
});

describe("terminalTranscript", () => {
  it("reads like a shell session an agent can be handed", () => {
    expect(
      terminalTranscript({
        command: "vp test run",
        output: "\u001b[31mFAIL\u001b[0m a.test.ts\n",
        exitCode: 1,
      }),
    ).toBe("$ vp test run\nFAIL a.test.ts\n[exit 1]");
  });

  it("omits a successful exit and missing output", () => {
    expect(terminalTranscript({ command: "ls", output: null, exitCode: 0 })).toBe("$ ls");
    expect(terminalTranscript({ command: "ls", output: "a\nb", exitCode: undefined })).toBe(
      "$ ls\na\nb",
    );
  });

  it("prefixes every line of a multi-line command", () => {
    expect(terminalTranscript({ command: "cd x &&\n  ls", output: null })).toBe(
      "$ cd x &&\n>   ls",
    );
  });
});

describe("terminalColorHex", () => {
  it("maps palette, cube, grayscale and truecolor values", () => {
    expect(terminalColorHex(1, TERMINAL_PALETTE.light)).toBe("#cd3131");
    expect(terminalColorHex(208)).toBe("#ff8700");
    expect(terminalColorHex(244)).toBe("#808080");
    expect(terminalColorHex("#0102ff")).toBe("#0102ff");
  });
});

describe("commandStartsExpanded", () => {
  it("opens every command when exposed", () => {
    expect(commandStartsExpanded("exposed", false)).toBe(true);
    expect(commandStartsExpanded("exposed", true)).toBe(true);
  });

  it("opens only failed commands when collapsed", () => {
    expect(commandStartsExpanded("collapsed", false)).toBe(false);
    expect(commandStartsExpanded("collapsed", true)).toBe(true);
  });
});
