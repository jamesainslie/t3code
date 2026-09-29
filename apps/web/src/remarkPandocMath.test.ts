import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { describe, expect, it } from "vite-plus/test";

import { pandocMathSyntax } from "./remarkPandocMath";

/** Every inline and block formula in parse order, as `inline:` or `block:` plus its TeX. */
function formulas(markdown: string): string[] {
  const found: string[] = [];
  const walk = (node: Nodes) => {
    if (node.type === "inlineMath") found.push(`inline:${node.value}`);
    if (node.type === "math") found.push(`block:${node.value}`);
    if ("children" in node) node.children.forEach(walk);
  };
  walk(
    fromMarkdown(markdown, {
      extensions: [pandocMathSyntax],
      mdastExtensions: [mathFromMarkdown()],
    }),
  );
  return found;
}

describe("pandocMathSyntax", () => {
  it("reads $…$ that hugs its formula", () => {
    expect(formulas("Euler: $e^{i\\pi}+1=0$ and $x$.")).toEqual([
      "inline:e^{i\\pi}+1=0",
      "inline:x",
    ]);
  });

  it("leaves prices as text", () => {
    expect(
      formulas(
        "costs $350,183 per 30 days and ingests 49.2 TB per day. It would cost $63 million, or $6 million to $262 million.",
      ),
    ).toEqual([]);
    expect(formulas("Between $5-$10 a seat.")).toEqual([]);
    expect(formulas("A $ 5 fee and a 5$ fee.")).toEqual([]);
  });

  it("leaves shell variables separated by spaces as text", () => {
    expect(formulas("Run echo $PATH and $SHELL here.")).toEqual([]);
  });

  it("skips a closing dollar before a digit and keeps looking", () => {
    expect(formulas("$a$1 then b$ done")).toEqual(["inline:a$1 then b"]);
  });

  it("does not open or close on an escaped dollar", () => {
    expect(formulas("Pay \\$x$ now")).toEqual([]);
    expect(formulas("$\\$5$ in TeX")).toEqual(["inline:\\$5"]);
  });

  it("keeps $$…$$ inline and block math as before", () => {
    expect(formulas("Area $$\\pi r^2$$ exactly")).toEqual(["inline:\\pi r^2"]);
    expect(formulas("$$\n\\int_0^1 x\\,dx\n$$")).toEqual(["block:\\int_0^1 x\\,dx"]);
  });

  it("never reads math inside code", () => {
    expect(formulas("`$x$` and\n\n```\n$y$\n```")).toEqual([]);
  });
});
