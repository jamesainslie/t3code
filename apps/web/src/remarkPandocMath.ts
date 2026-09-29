import type { Root } from "mdast";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import {
  asciiDigit,
  markdownLineEnding,
  markdownLineEndingOrSpace,
  markdownSpace,
} from "micromark-util-character";
import type {
  Code,
  Construct,
  Extension,
  State,
  Token,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";
import type { Plugin } from "unified";

const DOLLAR = 36;
const SPACE = 32;

const baseMath = math();
const baseMathText = baseMath.text![DOLLAR] as Construct;

/**
 * `remark-math`'s inline math with Pandoc's rule for a single `$` (fork). A
 * single dollar opens only when the formula follows it without a space, and
 * closes only right after the formula and not before a digit, so prose prices
 * such as `$63 million, or $6 million` stay text. `$$…$$` and block math parse
 * exactly as upstream, and the source text is never rewritten, so offsets and
 * lines stay true for citations, comments, and task list toggles.
 */
const tokenizePandocMathText: Tokenizer = function (this: TokenizeContext, effects, ok, nok) {
  let sizeOpen = 0;
  let sizeClose = 0;
  let closing: Token | undefined;
  let afterSpace = false;

  const start: State = (code) => {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    return sequenceOpen(code);
  };

  const sequenceOpen: State = (code) => {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen += 1;
      return sequenceOpen;
    }
    if (code === null || (sizeOpen === 1 && markdownLineEndingOrSpace(code))) return nok(code);
    effects.exit("mathTextSequence");
    return between(code);
  };

  const between: State = (code) => {
    if (code === null) return nok(code);
    if (code === DOLLAR) {
      closing = effects.enter("mathTextSequence");
      sizeClose = 0;
      return sequenceClose(code);
    }
    if (code === SPACE) {
      effects.enter("space");
      effects.consume(code);
      effects.exit("space");
      afterSpace = true;
      return between;
    }
    if (markdownLineEnding(code)) {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      afterSpace = true;
      return between;
    }
    effects.enter("mathTextData");
    return data(code);
  };

  const data: State = (code: Code) => {
    if (code === null || code === SPACE || code === DOLLAR || markdownLineEnding(code)) {
      effects.exit("mathTextData");
      return between(code);
    }
    effects.consume(code);
    afterSpace = markdownSpace(code);
    return data;
  };

  const sequenceClose: State = (code) => {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeClose += 1;
      return sequenceClose;
    }
    const pandocRejects = sizeOpen === 1 && (afterSpace || asciiDigit(code));
    if (sizeClose === sizeOpen && !pandocRejects) {
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok(code);
    }
    // Not a close: the dollars are part of the formula.
    closing!.type = "mathTextData";
    afterSpace = false;
    return data(code);
  };

  return start;
};

const pandocMathText: Construct = {
  name: "mathText",
  tokenize: tokenizePandocMathText,
  resolve: baseMathText.resolve!,
  previous: baseMathText.previous!,
};

/** micromark syntax: upstream block math plus Pandoc-rule inline math. */
export const pandocMathSyntax: Extension = {
  ...baseMath,
  text: { [DOLLAR]: pandocMathText },
};

/** Drop-in for `remark-math` that reads single-dollar math by Pandoc's rule. */
export const remarkPandocMath: Plugin<[], Root> = function () {
  const data = this.data() as {
    micromarkExtensions?: Extension[];
    fromMarkdownExtensions?: ReturnType<typeof mathFromMarkdown>[];
  };
  (data.micromarkExtensions ??= []).push(pandocMathSyntax);
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
};
