import { describe, expect, it } from "vite-plus/test";

import { normalizeChatMath } from "./chatMath";

describe("normalizeChatMath inline dollars (Pandoc rule)", () => {
  it("marks $…$ as math when it hugs its content", () => {
    expect(normalizeChatMath("Euler: $e^{i\\pi}+1=0$ inline.")).toBe(
      "Euler: $$e^{i\\pi}+1=0$$ inline.",
    );
    expect(normalizeChatMath("$a$ and $b$")).toBe("$$a$$ and $$b$$");
  });

  it("leaves prices alone", () => {
    for (const text of [
      "It costs $5 and $10 per month.",
      "Between $5-$10 a seat.",
      "Only $5.",
      "A $ 5 fee and a 5$ fee.",
    ]) {
      expect(normalizeChatMath(text)).toBe(text);
    }
  });

  it("leaves shell variables separated by spaces alone", () => {
    const text = "Run echo $PATH and $SHELL here.";
    expect(normalizeChatMath(text)).toBe(text);
  });

  it("does not open or close on an escaped dollar", () => {
    expect(normalizeChatMath("Pay \\$x$ now")).toBe("Pay \\$x$ now");
    expect(normalizeChatMath("$\\$5$ in TeX")).toBe("$$\\$5$$ in TeX");
  });

  it("keeps existing inline $$…$$ as written", () => {
    expect(normalizeChatMath("Area $$\\pi r^2$$ exactly")).toBe("Area $$\\pi r^2$$ exactly");
  });
});

describe("normalizeChatMath backslash delimiters", () => {
  it("turns \\(…\\) into inline math", () => {
    expect(normalizeChatMath("GPT style: \\(a^2+b^2=c^2\\) done")).toBe(
      "GPT style: $$a^2+b^2=c^2$$ done",
    );
  });

  it("turns a \\[…\\] block into display math, keeping its indentation", () => {
    expect(normalizeChatMath("Integral:\n\n\\[\n\\int_0^1 x\\,dx\n\\]\n\nDone")).toBe(
      "Integral:\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nDone",
    );
    expect(normalizeChatMath("- item\n\n  \\[\n  a+b\n  \\]")).toBe("- item\n\n  $$\n  a+b\n  $$");
  });

  it("gives a formula that fills its own line a display block", () => {
    expect(normalizeChatMath("So\n\\[x^2\\]\nthen")).toBe("So\n\n$$\nx^2\n$$\n\nthen");
    expect(normalizeChatMath("So\n$$x^2$$\nthen")).toBe("So\n\n$$\nx^2\n$$\n\nthen");
    expect(normalizeChatMath("> \\[x\\]")).toBe(">\n> $$\n> x\n> $$\n>");
  });

  it("typesets \\[…\\] inside a sentence in display style", () => {
    expect(normalizeChatMath("where \\[x=1\\] holds")).toBe("where $$\\displaystyle x=1$$ holds");
  });

  it("keeps an escaped backslash literal", () => {
    expect(normalizeChatMath("path C:\\\\(x) here")).toBe("path C:\\\\(x) here");
  });
});

describe("normalizeChatMath code", () => {
  it("never touches code spans", () => {
    const text = "Use `echo $HOME/$USER` and ``a $x$ b`` or `\\(y\\)`.";
    expect(normalizeChatMath(text)).toBe(text);
  });

  it("never touches fenced code", () => {
    const text = "```sh\necho $a$b\n\\[x\\]\n```\n\n~~~\n$x$\n~~~";
    expect(normalizeChatMath(text)).toBe(text);
  });

  it("leaves TeX inside display blocks as written", () => {
    const text = "$$\n\\text{cost } $5$ \\(y\\)\n$$";
    expect(normalizeChatMath(text)).toBe(text);
  });
});

describe("normalizeChatMath while streaming", () => {
  it("shows an unclosed display block as TeX code instead of swallowing the reply", () => {
    expect(normalizeChatMath("Result:\n\n$$\n\\frac{a}{b\n\nMore prose")).toBe(
      "Result:\n\n```tex\n\\frac{a}{b\n\nMore prose",
    );
    expect(normalizeChatMath("Result:\n\n\\[\n\\frac{a}{b")).toBe("Result:\n\n```tex\n\\frac{a}{b");
  });

  it("returns text without math untouched", () => {
    const text = "Plain **markdown** with a [link](https://example.com).";
    expect(normalizeChatMath(text)).toBe(text);
  });
});
