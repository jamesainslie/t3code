import type { SVGProps } from "react";

/**
 * Fork-only. The Lathe brand in place of upstream's T3 wordmark. Geometry comes from the brand
 * kit's `lockup-*-notag.svg` and `mark.svg`: the caret ground to a 45 degree point with an ember
 * tip, and "lathe" outlined from IBM Plex Mono SemiBold so it needs no font. The word and caret
 * take `currentColor`; only the tip keeps its ember.
 */
const EMBER = "#FF5A1F";

/** Each glyph in font units with its pen position: the lockup flips them onto a y-down canvas. */
const LATHE_GLYPHS = [
  { x: 604, y: 1061, d: "M72 101H236V639H72V740H364V101H529V0H72Z" },
  {
    x: 1204,
    y: 1061,
    d: "M490 0Q443 0 417.5 23.5Q392 47 387 89H382Q368 41 327.0 14.5Q286 -12 226 -12Q148 -12 102.0 29.0Q56 70 56 143Q56 299 285 299H376V333Q376 382 352.0 407.0Q328 432 274 432Q225 432 195.0 413.0Q165 394 144 364L71 426Q95 469 148.5 498.5Q202 528 287 528Q389 528 446.5 480.5Q504 433 504 339V96H565V0ZM269 76Q315 76 345.5 97.5Q376 119 376 156V225H288Q183 225 183 159V139Q183 108 206.0 92.0Q229 76 269 76Z",
  },
  {
    x: 1804,
    y: 1061,
    d: "M335 0Q261 0 226.0 39.0Q191 78 191 140V415H41V516H143Q174 516 187.0 528.5Q200 541 200 573V698H319V516H529V415H319V101H529V0Z",
  },
  {
    x: 2404,
    y: 1061,
    d: "M75 740H203V425H208Q225 467 260.5 497.5Q296 528 359 528Q435 528 482.5 477.5Q530 427 530 333V0H402V315Q402 427 305 427Q285 427 267.0 422.0Q249 417 234.5 406.5Q220 396 211.5 381.0Q203 366 203 345V0H75Z",
  },
  {
    x: 3004,
    y: 1061,
    d: "M312 -12Q250 -12 202.0 7.0Q154 26 121.5 61.0Q89 96 72.0 145.5Q55 195 55 257Q55 320 72.5 370.0Q90 420 122.0 455.0Q154 490 199.5 509.0Q245 528 302 528Q358 528 403.0 509.5Q448 491 479.5 457.0Q511 423 528.0 375.0Q545 327 545 269V227H183V214Q183 158 218.0 123.5Q253 89 316 89Q364 89 398.5 108.5Q433 128 456 160L529 87Q501 46 447.5 17.0Q394 -12 312 -12ZM303 434Q249 434 216.0 400.0Q183 366 183 310V303H417V312Q417 368 386.5 401.0Q356 434 303 434Z",
  },
] as const;

export function LatheWordmark({
  caretClassName,
  ...props
}: SVGProps<SVGSVGElement> & {
  /** Colours the caret apart from the word, such as a muted steel beside a white word. */
  caretClassName?: string;
}) {
  // The view box centres the word's ink vertically, so the caret hangs below it as in the lockup.
  return (
    <svg {...props} viewBox="160 -46 3389 1474" xmlns="http://www.w3.org/2000/svg">
      <path
        className={caretClassName}
        d="M160 160H418V1319.64H309.64L160 1170Z"
        fill="currentColor"
      />
      <path d="M309.64 1319.64H418V1428Z" fill={EMBER} />
      {LATHE_GLYPHS.map((glyph) => (
        <path
          key={glyph.x}
          d={glyph.d}
          fill="currentColor"
          transform={`translate(${glyph.x} ${glyph.y}) scale(1 -1)`}
        />
      ))}
    </svg>
  );
}

/** The caret alone on a square canvas, for icon slots sized like a glyph. */
export function LatheMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <path d="M462 162H562V820H520L462 762Z" fill="currentColor" />
      <path d="M520 820H562V862Z" fill={EMBER} />
    </svg>
  );
}
