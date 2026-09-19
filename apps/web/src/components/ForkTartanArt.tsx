import { useId } from "react";

/**
 * Fork-only header art. The Ainslie tartan (Scottish Register of Tartans STA 2187, designed by
 * Dr Gordon Teall in 1992) replaces upstream's nightly night sky so a fork build is recognisable
 * at a glance. `SidebarStageBackdrop` renders it wherever the nightly variant appears: the sidebar
 * header, the composer's send button and the CLI-connect masthead. Colours come from the
 * `--stage-tartan-*` custom properties in `index.css`.
 */

type TartanColour = "blue" | "black" | "red" | "white";

// Half sett with a pivot stripe at each end: B/24 K4 B4 R4 B4 R24 W4 K4 W4 K/4.
const AINSLIE_HALF_SETT: ReadonlyArray<readonly [TartanColour, number]> = [
  ["blue", 24],
  ["black", 4],
  ["blue", 4],
  ["red", 4],
  ["blue", 4],
  ["red", 24],
  ["white", 4],
  ["black", 4],
  ["white", 4],
  ["black", 4],
];

// A full repeat reflects the half sett about its pivots without doubling them.
const AINSLIE_SETT = [...AINSLIE_HALF_SETT, ...AINSLIE_HALF_SETT.slice(1, -1).toReversed()];
const SETT_THREADS = AINSLIE_SETT.reduce((sum, [, count]) => sum + count, 0);

// One repeat spans 112 units of the 96-unit-tall canvas, so the header shows about one sett and
// the 4-unit twill period divides the tile evenly, which keeps the diagonal continuous at seams.
const SETT_REPEAT = 112;
const TWILL_PERIOD = 4;
const THREAD_SCALE = SETT_REPEAT / SETT_THREADS;

const STRIPES = AINSLIE_SETT.reduce<Array<{ colour: TartanColour; start: number; size: number }>>(
  (stripes, [colour, count]) => {
    const previous = stripes.at(-1);
    const start = previous ? previous.start + previous.size : 0;
    stripes.push({ colour, start, size: count * THREAD_SCALE });
    return stripes;
  },
  [],
);

// The tile offset puts a plain red block under the "T3 Code" wordmark (x 12..95, y 18..40) and
// the white-and-black line cross just right of and below it, where the header is still opaque.
const TILE_OFFSET_X = 42;
const TILE_OFFSET_Y = -10;

// The legibility scrim darkens the left edge under the wordmark and eases off past it.
const SCRIM_WIDTH = 140;

const STAGE_CANVAS_VIEW_BOX = "0 0 8192 96";
const STAGE_BUTTON_VIEW_BOX = "96 0 8192 96";

function tartanFill(colour: TartanColour) {
  return { fill: `var(--stage-tartan-${colour})` };
}

export function AinslieTartanArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const twillId = `${idPrefix}-stage-tartan-twill`;
  const weftMaskId = `${idPrefix}-stage-tartan-weft`;
  const weaveId = `${idPrefix}-stage-tartan-weave`;
  const scrimId = `${idPrefix}-stage-tartan-scrim`;

  return (
    <svg
      className="stage-art stage-nightly stage-tartan h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? STAGE_BUTTON_VIEW_BOX : STAGE_CANVAS_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* 2/2 twill: the weft shows through the diagonal half of each 4-unit cell. */}
        <pattern
          id={twillId}
          width={TWILL_PERIOD}
          height={TWILL_PERIOD}
          patternUnits="userSpaceOnUse"
        >
          <path d="M0 0H2L4 2V4ZM0 2L2 4H0Z" style={tartanFill("black")} />
        </pattern>
        <mask
          id={weftMaskId}
          x="0"
          y="0"
          width={SETT_REPEAT}
          height={SETT_REPEAT}
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          style={{ maskType: "alpha" }}
        >
          <rect width={SETT_REPEAT} height={SETT_REPEAT} fill={`url(#${twillId})`} />
        </mask>
        <pattern
          id={weaveId}
          width={SETT_REPEAT}
          height={SETT_REPEAT}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${TILE_OFFSET_X} ${TILE_OFFSET_Y})`}
        >
          <g shapeRendering="crispEdges">
            {STRIPES.map((stripe) => (
              <rect
                key={`warp-${stripe.start}`}
                x={stripe.start}
                width={stripe.size}
                height={SETT_REPEAT}
                style={tartanFill(stripe.colour)}
              />
            ))}
          </g>
          <g mask={`url(#${weftMaskId})`} shapeRendering="crispEdges">
            {STRIPES.map((stripe) => (
              <rect
                key={`weft-${stripe.start}`}
                y={stripe.start}
                width={SETT_REPEAT}
                height={stripe.size}
                style={tartanFill(stripe.colour)}
              />
            ))}
          </g>
        </pattern>
        <linearGradient
          id={scrimId}
          x1="0"
          y1="0"
          x2={SCRIM_WIDTH}
          y2="0"
          gradientUnits="userSpaceOnUse"
          spreadMethod="pad"
        >
          <stop style={{ stopColor: "var(--stage-tartan-scrim)" }} stopOpacity="0.62" />
          <stop
            offset="0.98"
            style={{ stopColor: "var(--stage-tartan-scrim)" }}
            stopOpacity="0.24"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-tartan-scrim)" }} stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <rect width="100%" height="96" fill={`url(#${weaveId})`} />
      <rect width="100%" height="96" fill={`url(#${scrimId})`} />
      <rect width="100%" height="96" style={tartanFill("black")} opacity="0.14" />
    </svg>
  );
}
