// Procedural artwork for the fork's stage editions. `export-edition-art.ts` renders these
// into the web strips and the desktop icons; everything is seeded, so a rerun reproduces
// the committed files byte for byte.
//
// Text is drawn from pixel glyph paths rather than <text>: the strips load as images, which
// cannot use the page's fonts, and katakana would render as tofu on machines without CJK
// fonts.

export const GENERATED_EDITIONS = [
  "lathe",
  "rain",
  "horizon",
  "night-city",
  "trace",
  "amber",
  "glitch",
] as const;
export type GeneratedEdition = (typeof GENERATED_EDITIONS)[number];
export type IconEdition = GeneratedEdition | "tartan";

/** Strip size in art units. The web scales the 96-unit height to its container. */
const STRIP_WIDTH = 2048;
const STRIP_HEIGHT = 96;

/**
 * The Lathe caret on Icon Composer's 128-unit layer canvas, the geometry of
 * each assets/lathe app-icon.icon: a steel bar ground to a 45 degree point, and
 * the ember tip drawn over it. Exported for the brand-leak test.
 */
export const LATHE_CARET_PATH = "M56.85 23.6L71.15 23.6L71.15 101.3L56.85 87Z";
export const LATHE_CARET_TIP_PATH = "M65.14 95.29L71.15 95.29L71.15 101.3Z";
const EMBER = "#FF5A1F";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (value: number) => String(Math.round(value * 100) / 100);

/** Hands out ids that stay unique within one SVG document. */
function idFactory() {
  let next = 0;
  return (prefix: string) => `${prefix}${++next}`;
}
type Ids = ReturnType<typeof idFactory>;

// ---------------------------------------------------------------------------------------
// Pixel glyphs

/** 3x5 capitals, digits and the punctuation the boot log and signs use. */
const FONT_3X5: Record<string, readonly [string, string, string, string, string]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", ".##"],
  V: ["#.#", "#.#", "#.#", ".#.", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  ".": ["...", "...", "...", "...", ".#."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  ">": ["#..", ".#.", "..#", ".#.", "#.."],
  "<": ["..#", ".#.", "#..", ".#.", "..#"],
  "-": ["...", "...", "###", "...", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "[": ["##.", "#..", "#..", "#..", "##."],
  "]": [".##", "..#", "..#", "..#", ".##"],
  "#": ["#.#", "###", "#.#", "###", "#.#"],
  "%": ["#.#", "..#", ".#.", "#..", "#.#"],
  "=": ["...", "###", "...", "###", "..."],
  " ": ["...", "...", "...", "...", "..."],
};

/** Rows of `#`/`.` cells, `width` wide, to a path of merged horizontal runs. */
function bitmapPath(cells: string, width: number, pixel: number) {
  let d = "";
  for (let row = 0; row * width < cells.length; row++) {
    let col = 0;
    while (col < width) {
      if (cells[row * width + col] !== "#") {
        col++;
        continue;
      }
      const start = col;
      while (col < width && cells[row * width + col] === "#") col++;
      d += `M${n(start * pixel)} ${n(row * pixel)}h${n((col - start) * pixel)}v${n(pixel)}h${n(-(col - start) * pixel)}z`;
    }
  }
  return d;
}

function font3x5(char: string) {
  return (FONT_3X5[char] ?? FONT_3X5[" "]!).join("");
}

/** Pixel text as one path, origin at the top left of the first cell. */
function pixelText(text: string, pixel: number) {
  let d = "";
  [...text.toUpperCase()].forEach((char, index) => {
    const glyph = bitmapPath(font3x5(char), 3, pixel);
    if (glyph) d += glyph.replace(/M([\d.]+)/g, (_, x) => `M${n(Number(x) + index * 4 * pixel)}`);
  });
  return d;
}

// Strokes on a 5x7 grid that combine into katakana-like marks for the rain and the sign.
const KANA_STROKES = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ],
  [
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
  ],
  [
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
  ],
  [
    [0, 6],
    [1, 6],
    [2, 6],
    [3, 6],
  ],
  [
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
    [2, 5],
    [2, 6],
  ],
  [
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
    [4, 5],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  [
    [4, 3],
    [3, 4],
    [2, 5],
    [1, 6],
  ],
  [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  [
    [4, 0],
    [4, 1],
    [4, 2],
    [3, 3],
    [2, 4],
    [1, 5],
    [0, 6],
  ],
  [
    [0, 2],
    [1, 3],
    [1, 4],
  ],
] as const;

function kanaGlyphs(count: number, seed: number) {
  const random = rng(seed);
  return Array.from({ length: count }, () => {
    const cells = Array.from({ length: 35 }, () => ".");
    const picks = new Set<number>();
    const strokes = 2 + Math.floor(random() * 2);
    while (picks.size < strokes) picks.add(Math.floor(random() * KANA_STROKES.length));
    for (const pick of picks) for (const [x, y] of KANA_STROKES[pick]!) cells[y * 5 + x] = "#";
    return cells.join("");
  });
}

// ---------------------------------------------------------------------------------------
// Strips

function scrim(ids: Ids, color: string, width: number) {
  const id = ids("scrim");
  return `<defs><linearGradient id="${id}" x1="0" x2="140" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="${color}" stop-opacity="0.62"/><stop offset="0.98" stop-color="${color}" stop-opacity="0.22"/><stop offset="1" stop-color="${color}" stop-opacity="0.18"/></linearGradient></defs><rect width="${width}" height="96" fill="url(#${id})"/>`;
}

interface ArtOptions {
  readonly ids: Ids;
  readonly width: number;
  readonly withScrim: boolean;
  readonly seed?: number;
}

function rainArt({ ids, width, withScrim, seed = 7 }: ArtOptions) {
  const random = rng(seed);
  const glyphs = kanaGlyphs(36, 101);
  const glyphIds = glyphs.map(() => ids("k"));
  const bg = ids("bg");
  let uses = "";
  for (let x = 3; x < width; x += 7.4) {
    if (random() < 0.38) continue;
    const head = 8 + random() * 100;
    const length = 3 + Math.floor(random() * 9);
    const bright = random() < 0.3;
    for (let k = 0; k < length; k++) {
      const y = head - k * 8.2;
      const glyph = glyphIds[Math.floor(random() * glyphIds.length)]!;
      if (y < -6 || y > 100) continue;
      const lead = k === 0 && bright;
      const opacity = (lead ? 0.85 : 0.5 * (1 - k / length) + 0.04) * 0.72;
      uses += `<use href="#${glyph}" x="${n(x)}" y="${n(y - 6)}" fill="${lead ? "#d6ffe2" : "#35d474"}" opacity="${n(opacity)}"/>`;
    }
  }
  const defs = glyphs
    .map((cells, index) => `<path id="${glyphIds[index]}" d="${bitmapPath(cells, 5, 0.85)}"/>`)
    .join("");
  return `<defs><linearGradient id="${bg}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#04130b"/><stop offset="1" stop-color="#010603"/></linearGradient>${defs}</defs><rect width="${width}" height="96" fill="url(#${bg})"/>${uses}${withScrim ? scrim(ids, "#000", width) : ""}`;
}

function horizonArt({
  ids,
  width,
  withScrim,
  seed = 3,
  vanish = 236,
}: ArtOptions & { vanish?: number }) {
  const random = rng(seed);
  const horizon = 58;
  const [sky, sun, sunMask, glow] = [ids("sky"), ids("sun"), ids("sm"), ids("gl")];
  let stars = "";
  for (let i = 0; i < width / 14; i++) {
    stars += `<circle cx="${n(random() * width)}" cy="${n(random() * 44)}" r="${n(0.25 + random() * 0.35)}" fill="#ffd9f4" opacity="${n(0.2 + random() * 0.5)}"/>`;
  }
  let slits = "";
  for (let i = 0; i < 7; i++) {
    slits += `<rect x="${vanish - 40}" y="${n(horizon - 22 + i * 3.4)}" width="80" height="${n(0.5 + i * 0.32)}" fill="#000"/>`;
  }
  let grid = "";
  for (let k = 1; k < 14; k++) {
    const y = horizon + 38 * (1 - 1 / (1 + 0.22 * k * k));
    grid += `<path d="M0 ${n(y)}H${width}" opacity="${n(0.15 + k * 0.035)}"/>`;
  }
  for (let j = -80; j <= 80; j++)
    grid += `<path d="M${n(vanish + j * 3)} ${horizon}L${n(vanish + j * 44)} 96"/>`;
  return `<defs><linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse"><stop stop-color="#06021a"/><stop offset="0.6" stop-color="#1d0838"/><stop offset="1" stop-color="#4a0f4e"/></linearGradient><linearGradient id="${sun}" x1="0" y1="${horizon - 32}" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse"><stop stop-color="#ffc27a"/><stop offset="1" stop-color="#ff3e8a"/></linearGradient><mask id="${sunMask}"><rect x="${vanish - 40}" y="0" width="80" height="${horizon}" fill="#fff"/>${slits}</mask><radialGradient id="${glow}" cx="${vanish}" cy="${horizon}" r="120" gradientUnits="userSpaceOnUse" gradientTransform="translate(${vanish} ${horizon}) scale(1 0.35) translate(${-vanish} ${-horizon})"><stop stop-color="#ff4fd8" stop-opacity="0.35"/><stop offset="1" stop-color="#ff4fd8" stop-opacity="0"/></radialGradient></defs><rect width="${width}" height="${horizon}" fill="url(#${sky})"/>${stars}<circle cx="${vanish}" cy="${horizon}" r="30" fill="url(#${sun})" mask="url(#${sunMask})" opacity="0.62"/><rect y="${horizon}" width="${width}" height="${96 - horizon}" fill="#0b0319"/><rect width="${width}" height="96" fill="url(#${glow})"/><g stroke="#c63cff" stroke-width="0.45" opacity="0.5">${grid}</g><path d="M0 ${horizon}H${width}" stroke="#ff4fd8" stroke-width="2.4" opacity="0.18"/><path d="M0 ${horizon}H${width}" stroke="#ff7ae2" stroke-width="0.5" opacity="0.85"/>${withScrim ? scrim(ids, "#05010f", width) : ""}`;
}

function nightCityArt({
  ids,
  width,
  withScrim,
  seed = 11,
  sign = 228,
}: ArtOptions & { sign?: number }) {
  const random = rng(seed);
  const [sky, haze, glow] = [ids("sky"), ids("hz"), ids("sg")];
  const layer = (
    fill: string,
    minH: number,
    maxH: number,
    minW: number,
    maxW: number,
    lit: number,
  ) => {
    let svg = "";
    let x = -4;
    while (x < width) {
      const w = minW + random() * (maxW - minW);
      const h = minH + random() * (maxH - minH);
      const top = 96 - h;
      svg += `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`;
      if (random() < 0.3)
        svg += `<rect x="${n(x + w * 0.4)}" y="${n(top - 5)}" width="0.5" height="5" fill="${fill}"/>`;
      for (let wy = top + 3; wy < 94; wy += 3.6) {
        for (let wx = x + 2; wx < x + w - 2; wx += 3.2) {
          if (random() < lit) {
            svg += `<rect x="${n(wx)}" y="${n(wy)}" width="1.3" height="1.6" fill="${random() < 0.75 ? "#ffb45a" : "#6fe3ff"}" opacity="${n(0.35 + random() * 0.45)}"/>`;
          }
        }
      }
      x += w + (random() < 0.25 ? 2 + random() * 4 : 0.4);
    }
    return svg;
  };
  let rain = "";
  for (let i = 0; i < width / 3; i++) {
    const length = 4 + random() * 6;
    rain += `<path d="M${n(random() * width)} ${n(random() * 96)}l${n(-length * 0.22)} ${n(length)}"/>`;
  }
  const far = layer("#111a2e", 34, 72, 10, 26, 0.05);
  const near = layer("#070b15", 18, 50, 16, 40, 0.07);
  const signGlyphs = kanaGlyphs(3, 17).map((cells) => bitmapPath(cells, 5, 0.9));
  let signs = "";
  for (let x = sign; x < width; x += 760) {
    const kana = signGlyphs
      .map(
        (d, index) =>
          `<path transform="translate(${n(x + 2.25)} ${n(24.5 + index * 8)})" d="${d}"/>`,
      )
      .join("");
    signs += `<g filter="url(#${glow})"><rect x="${x}" y="22" width="9" height="28" rx="1.2" fill="none" stroke="#ff3ea5" stroke-width="0.6" opacity="0.9"/></g><rect x="${x}" y="22" width="9" height="28" rx="1.2" fill="#ff3ea5" opacity="0.08"/><g fill="#ff8ccf" opacity="0.9">${kana}</g><g filter="url(#${glow})"><path d="M${x + 236} 40h22" stroke="#45e3ff" stroke-width="0.8" opacity="0.8"/></g><path transform="translate(${n(x + 236.6)} ${n(34.6)})" d="${pixelText("NOODLE", 0.55)}" fill="#8ff0ff" opacity="0.8"/>`;
  }
  return `<defs><linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#04070f"/><stop offset="1" stop-color="#0d1426"/></linearGradient><linearGradient id="${haze}" x1="0" y1="40" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop stop-color="#5a1460" stop-opacity="0"/><stop offset="1" stop-color="#5a1460" stop-opacity="0.38"/></linearGradient><filter id="${glow}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="${width}" height="96" fill="url(#${sky})"/>${far}<rect width="${width}" height="96" fill="url(#${haze})"/>${near}${signs}<g stroke="#a9ccff" stroke-width="0.3" opacity="0.14">${rain}</g>${withScrim ? scrim(ids, "#02040a", width) : ""}`;
}

function traceArt({ ids, width, withScrim, seed = 5 }: ArtOptions) {
  const random = rng(seed);
  const bg = ids("bg");
  const grid = 6;
  const directions = [
    [1, 0],
    [1, 0],
    [1, -1],
    [1, 1],
    [0, 1],
    [0, -1],
  ] as const;
  let copper = "";
  let live = "";
  let vias = "";
  let silk = "";
  for (let i = 0; i < width / 9; i++) {
    // Traces start right of the wordmark so the left edge stays quiet.
    let x = Math.round((120 + random() * (width - 120)) / grid) * grid;
    let y = Math.round((6 + random() * 84) / grid) * grid;
    let d = `M${x} ${y}`;
    const isLive = random() < 0.08;
    vias += `<circle cx="${x}" cy="${y}" r="1.7" fill="#06201b" stroke="#c88a4b" stroke-width="0.7"/>`;
    for (let s = 0; s < 3 + random() * 4; s++) {
      const [dx, dy] = directions[Math.floor(random() * directions.length)]!;
      const length = grid * (1 + Math.floor(random() * 4));
      x += dx * length;
      y = Math.min(90, Math.max(6, y + dy * length));
      d += `L${x} ${y}`;
    }
    if (isLive) live += `<path d="${d}"/>`;
    else copper += `<path d="${d}"/>`;
    vias += `<circle cx="${x}" cy="${y}" r="1.4" fill="#c88a4b" opacity="0.8"/>`;
  }
  for (let x = 300; x < width; x += 520) {
    let pads = "";
    for (let i = 0; i < 7; i++) {
      pads += `<rect x="${x + 2 + i * 4}" y="27" width="1.6" height="4" fill="#c88a4b" opacity="0.7"/><rect x="${x + 2 + i * 4}" y="61" width="1.6" height="4" fill="#c88a4b" opacity="0.7"/>`;
    }
    silk += `<rect x="${x}" y="33" width="30" height="26" rx="1" fill="#0b2a24" stroke="#cfe7df" stroke-opacity="0.22" stroke-width="0.4"/>${pads}<circle cx="${x + 4}" cy="37" r="0.9" fill="#cfe7df" opacity="0.3"/><path transform="translate(${n(x + 11.5)} 69)" d="${pixelText(`U${3 + (x % 7)}`, 0.5)}" fill="#cfe7df" opacity="0.28"/>`;
  }
  return `<defs><linearGradient id="${bg}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#05201a"/><stop offset="1" stop-color="#03120f"/></linearGradient></defs><rect width="${width}" height="96" fill="url(#${bg})"/><g fill="none" stroke="#b9783e" stroke-width="1.1" stroke-linejoin="round" opacity="0.5">${copper}</g><g fill="none" stroke="#3fe0c5" stroke-width="2.6" stroke-linejoin="round" opacity="0.14">${live}</g><g fill="none" stroke="#5ff2d6" stroke-width="0.9" stroke-linejoin="round" opacity="0.75">${live}</g>${vias}${silk}${withScrim ? scrim(ids, "#010907", width) : ""}`;
}

const BOOT_LOG = [
  "BIOS 4.06 ROM SHADOW ........ OK",
  "> MOUNT /DEV/ICE0 /NET",
  "ICE HANDSHAKE  0X7F3A..C2  ACK",
  "> TRACE --ROUTE SPRAWL.GW",
  "  HOP 03  CHIBA.RELAY   12MS",
  "  HOP 07  FREESIDE.IX   41MS",
  "> DECRYPT PAYLOAD.BLK",
  "  [##########--------] 52%",
  "MEM 640K  EXT 15360K  OK",
  "> AGENT.SPAWN --QUIET",
  "  PID 4471  CLAUDE  READY",
  "  PID 4472  CODEX   READY",
];

function amberArt({ ids, width, withScrim, seed = 2 }: ArtOptions) {
  const random = rng(seed);
  const [scan, glow, vignette] = [ids("sl"), ids("gl"), ids("vg")];
  const lineIds = BOOT_LOG.map(() => ids("ln"));
  let lines = "";
  for (let x = 120, column = 0; x < width; x += 250, column++) {
    for (let row = 0; row < 11; row++) {
      const line = lineIds[(row + column * 5) % lineIds.length]!;
      lines += `<use href="#${line}" x="${x}" y="${n(4.6 + row * 8.2)}" opacity="${n(0.14 + random() * 0.16)}"/>`;
    }
  }
  const defs = BOOT_LOG.map(
    (line, index) => `<path id="${lineIds[index]}" d="${pixelText(line, 0.85)}"/>`,
  ).join("");
  return `<defs>${defs}<pattern id="${scan}" width="4" height="2" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.4"/></pattern><radialGradient id="${glow}" cx="0.3" cy="0.4" r="0.9"><stop stop-color="#ff9a00" stop-opacity="0.16"/><stop offset="1" stop-color="#ff9a00" stop-opacity="0"/></radialGradient><linearGradient id="${vignette}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#000" stop-opacity="0.35"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/><stop offset="0.75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient></defs><rect width="${width}" height="96" fill="#0f0802"/><rect width="${width}" height="96" fill="url(#${glow})"/><g fill="#ffb000">${lines}</g><rect x="229" y="37.4" width="3.3" height="4.3" fill="#ffc34d" opacity="0.7"/><rect width="${width}" height="96" fill="url(#${scan})"/><rect width="${width}" height="96" fill="url(#${vignette})"/>${withScrim ? scrim(ids, "#050200", width) : ""}`;
}

function glitchArt({ ids, width, withScrim, seed = 19 }: ArtOptions) {
  const random = rng(seed);
  const dither = ids("dn");
  let noise = "";
  for (let i = 0; i < 40; i++) {
    noise += `<rect x="${Math.floor(random() * 16)}" y="${Math.floor(random() * 16)}" width="1" height="1" fill="#fff" opacity="${n(0.03 + random() * 0.05)}"/>`;
  }
  let bands = "";
  for (let i = 0; i < width / 22; i++) {
    const y = random() * 96;
    const h = 0.6 + random() * (random() < 0.2 ? 7 : 2);
    const x = random() * width;
    const w = 30 + random() * 260;
    const color = random() < 0.5 ? "#18e6ff" : "#ff2e63";
    const opacity = 0.06 + random() * 0.16;
    bands += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${color}" opacity="${n(opacity)}"/>`;
    if (random() < 0.45) {
      bands += `<rect x="${n(x + 3 + random() * 8)}" y="${n(y + 0.8)}" width="${n(w * 0.7)}" height="${n(h * 0.6)}" fill="${color === "#18e6ff" ? "#ff2e63" : "#18e6ff"}" opacity="${n(opacity * 0.8)}"/>`;
    }
  }
  const tones = ["#2a2e3a", "#323646", "#1d3a44", "#3a1f2c"];
  let blocks = "";
  for (let i = 0; i < width / 40; i++) {
    const bx = Math.floor((random() * width) / 6) * 6;
    const by = Math.floor((random() * 90) / 6) * 6;
    const count = 1 + Math.floor(random() * 4);
    for (let k = 0; k < count; k++) {
      blocks += `<rect x="${bx + k * 6}" y="${by}" width="6" height="6" fill="${tones[Math.floor(random() * tones.length)]}" opacity="${n(0.4 + random() * 0.4)}"/>`;
    }
  }
  let lines = "";
  for (let i = 0; i < width / 120; i++) {
    lines += `<rect x="${n(random() * width)}" y="${n(random() * 96)}" width="${n(40 + random() * 200)}" height="0.35" fill="#eaf6ff" opacity="${n(0.15 + random() * 0.25)}"/>`;
  }
  return `<defs><pattern id="${dither}" width="16" height="16" patternUnits="userSpaceOnUse">${noise}</pattern></defs><rect width="${width}" height="96" fill="#0c0d12"/>${blocks}<rect width="${width}" height="96" fill="url(#${dither})"/>${bands}${lines}${withScrim ? scrim(ids, "#000", width) : ""}`;
}

/**
 * Turned steel in the brand's AlTiN violet-black: the fine feed marks a finishing pass leaves
 * and the sheen of a round bar. No tool and no ember, so the wordmark's caret is the one mark.
 */
function latheArt({ ids, width, withScrim, seed = 29 }: ArtOptions) {
  const random = rng(seed);
  const shade = ids("cy");
  // Feed marks: the near-vertical grooves each turn leaves, in three strengths.
  const strengths = [0.03, 0.05, 0.07];
  const feed = strengths.map(() => "");
  for (let x = 0.5; x < width + 1; x += 1.3) {
    feed[Math.floor(random() * strengths.length)] += `M${n(x)} 0l-0.7 96`;
  }
  const marks = feed
    .map(
      (d, index) =>
        `<path d="${d}" stroke="#AEB4BE" stroke-width="0.3" opacity="${strengths[index]}"/>`,
    )
    .join("");
  return `<defs><linearGradient id="${shade}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#000" stop-opacity="0.5"/><stop offset="0.3" stop-color="#FFFFFF" stop-opacity="0.05"/><stop offset="0.38" stop-color="#FFFFFF" stop-opacity="0.09"/><stop offset="0.52" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs><rect width="${width}" height="96" fill="#231C2B"/>${marks}<rect width="${width}" height="96" fill="url(#${shade})"/>${withScrim ? scrim(ids, "#000", width) : ""}`;
}

type TartanColour = "blue" | "black" | "red" | "white";

/** The Ainslie tartan, as `ForkTartanArt.tsx` weaves it, with fixed pigments for icons. */
function tartanArt({ ids, width }: ArtOptions) {
  const colours: Record<TartanColour, string> = {
    blue: "#2c3f86",
    black: "#1b1b1b",
    red: "#b02a26",
    white: "#e0e0e0",
  };
  const half: ReadonlyArray<readonly [TartanColour, number]> = [
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
  const sett = [...half, ...half.slice(1, -1).toReversed()];
  const repeat = 112;
  const scale = repeat / sett.reduce((sum, [, count]) => sum + count, 0);
  let offset = 0;
  const stripes = sett.map(([colour, count]) => {
    const stripe = { colour: colours[colour], start: offset, size: count * scale };
    offset += stripe.size;
    return stripe;
  });
  const [twill, mask, weave] = [ids("tw"), ids("m"), ids("wv")];
  const warp = stripes
    .map(
      (s) => `<rect x="${n(s.start)}" width="${n(s.size)}" height="${repeat}" fill="${s.colour}"/>`,
    )
    .join("");
  const weft = stripes
    .map(
      (s) => `<rect y="${n(s.start)}" height="${n(s.size)}" width="${repeat}" fill="${s.colour}"/>`,
    )
    .join("");
  return `<defs><pattern id="${twill}" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H2L4 2V4ZM0 2L2 4H0Z" fill="#fff"/></pattern><mask id="${mask}" x="0" y="0" width="${repeat}" height="${repeat}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="${repeat}" height="${repeat}" fill="url(#${twill})"/></mask><pattern id="${weave}" width="${repeat}" height="${repeat}" patternUnits="userSpaceOnUse" patternTransform="translate(42 -10)"><g shape-rendering="crispEdges">${warp}</g><g mask="url(#${mask})" shape-rendering="crispEdges">${weft}</g></pattern></defs><rect width="${width}" height="96" fill="url(#${weave})"/><rect width="${width}" height="96" fill="#1b1b1b" opacity="0.14"/>`;
}

const STRIP_ART: Record<GeneratedEdition, (options: ArtOptions) => string> = {
  lathe: latheArt,
  rain: rainArt,
  horizon: horizonArt,
  "night-city": nightCityArt,
  trace: traceArt,
  amber: amberArt,
  glitch: glitchArt,
};

/** The web strip: STRIP_WIDTH x 96 with the wordmark scrim at the left edge. */
export function editionStripSvg(edition: GeneratedEdition) {
  const art = STRIP_ART[edition]({ ids: idFactory(), width: STRIP_WIDTH, withScrim: true });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_WIDTH}" height="${STRIP_HEIGHT}" viewBox="0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}" fill="none">${art}</svg>`;
}

// ---------------------------------------------------------------------------------------
// Icons

const ICON_SIZE = 1024;
const ICON_RADIUS = 230;
/** The macOS pre-Tahoe safe area: an 824px body inset 100px, see assets/README.md. */
const MAC_BODY = 824;
const MAC_INSET = 100;

const markTransform = (scale: number, cx: number, cy: number) =>
  `translate(${n(cx - 64 * scale)} ${n(cy - 62.45 * scale)}) scale(${scale})`;

/** One 96-unit window of a strip, scaled to fill the icon tile. */
function iconWindow(
  art: (options: ArtOptions) => string,
  ids: Ids,
  originX: number,
  extra: Partial<ArtOptions> & Record<string, unknown> = {},
) {
  const inner = art({ ids, width: 1400, withScrim: false, ...extra });
  return `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="${originX} 0 96 96" preserveAspectRatio="xMidYMid slice">${inner}</svg>`;
}

function iconBody(edition: IconEdition, ids: Ids) {
  const scale = 8;
  const mark = markTransform(scale, 512, 500);
  // Every edition keeps the brand's one accent on the top layer of its mark.
  const tip = (transform: string) =>
    `<path d="${LATHE_CARET_TIP_PATH}" transform="${transform}" fill="${EMBER}"/>`;
  const glow = ids("fx");
  const glowFilter = (deviation: number) =>
    `<filter id="${glow}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${deviation}"/></filter>`;
  switch (edition) {
    case "lathe":
      // The prod tile: violet-black turned steel under a steel caret.
      return `${iconWindow(latheArt, ids, 20)}<path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#AEB4BE"/>${tip(mark)}`;
    case "tartan":
      return `${iconWindow(tartanArt, ids, 30)}<path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#fff"/>${tip(mark)}`;
    case "rain":
      return `<defs>${glowFilter(18)}</defs>${iconWindow(rainArt, ids, 40, { seed: 41 })}<rect width="1024" height="1024" fill="#000" opacity="0.25"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#2bff7a" filter="url(#${glow})" opacity="0.9"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#c9ffd9"/>${tip(mark)}`;
    case "horizon": {
      const chrome = ids("chrome");
      return `<defs><linearGradient id="${chrome}" x1="0" y1="330" x2="0" y2="720" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff"/><stop offset="0.5" stop-color="#e9dcff"/><stop offset="0.52" stop-color="#7b5cff"/><stop offset="1" stop-color="#ffd1f0"/></linearGradient></defs>${iconWindow(horizonArt, ids, 6, { vanish: 54 })}<path d="${LATHE_CARET_PATH}" transform="${markTransform(scale, 512, 512)}" fill="#ff3ea5" opacity="0.85"/><path d="${LATHE_CARET_PATH}" transform="${markTransform(scale, 512, 488)}" fill="url(#${chrome})"/>${tip(markTransform(scale, 512, 488))}`;
    }
    case "night-city": {
      const raised = markTransform(scale, 512, 430);
      return `<defs>${glowFilter(22)}</defs>${iconWindow(nightCityArt, ids, 180, { seed: 13, sign: 248 })}<rect width="1024" height="560" fill="#02040a" opacity="0.35"/><path d="${LATHE_CARET_PATH}" transform="${raised}" fill="#45e3ff" filter="url(#${glow})" opacity="0.7"/><path d="${LATHE_CARET_PATH}" transform="${raised}" fill="#f4fbff"/>${tip(raised)}`;
    }
    case "trace": {
      const gold = ids("gold");
      return `<defs>${glowFilter(10)}<linearGradient id="${gold}" x1="0" y1="330" x2="0" y2="720" gradientUnits="userSpaceOnUse"><stop stop-color="#f6d08f"/><stop offset="1" stop-color="#b9783e"/></linearGradient></defs>${iconWindow(traceArt, ids, 120, { seed: 9 })}<rect width="1024" height="1024" fill="#021310" opacity="0.3"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#000" opacity="0.5" filter="url(#${glow})"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="url(#${gold})"/>${tip(mark)}`;
    }
    case "amber": {
      const [scan, crt] = [ids("scan"), ids("crt")];
      return `<defs>${glowFilter(26)}<pattern id="${scan}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="3.5" fill="#000" opacity="0.35"/></pattern><radialGradient id="${crt}" cx="0.5" cy="0.5" r="0.72"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></radialGradient></defs>${iconWindow(amberArt, ids, 112)}<rect width="1024" height="1024" fill="#0f0802" opacity="0.55"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#ff9a00" filter="url(#${glow})" opacity="0.8"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#ffc04a"/>${tip(mark)}<rect width="1024" height="1024" fill="url(#${scan})"/><rect width="1024" height="1024" fill="url(#${crt})"/>`;
    }
    case "glitch": {
      const [bandA, bandB] = [ids("ba"), ids("bb")];
      return `<defs><clipPath id="${bandA}"><rect width="1024" height="560"/><rect y="610" width="1024" height="414"/></clipPath><clipPath id="${bandB}"><rect y="560" width="1024" height="50"/></clipPath></defs>${iconWindow(glitchArt, ids, 200, { seed: 23 })}<g clip-path="url(#${bandA})"><path d="${LATHE_CARET_PATH}" transform="${markTransform(scale, 500, 500)}" fill="#18e6ff" opacity="0.8"/><path d="${LATHE_CARET_PATH}" transform="${markTransform(scale, 524, 500)}" fill="#ff2e63" opacity="0.8"/><path d="${LATHE_CARET_PATH}" transform="${mark}" fill="#f2f6ff"/>${tip(mark)}</g><g clip-path="url(#${bandB})"><path d="${LATHE_CARET_PATH}" transform="${markTransform(scale, 470, 500)}" fill="#18e6ff" opacity="0.85"/><path d="${LATHE_CARET_PATH}" transform="${markTransform(scale, 494, 500)}" fill="#f2f6ff"/>${tip(markTransform(scale, 494, 500))}</g>`;
    }
  }
}

function iconTile(edition: IconEdition, ids: Ids) {
  const clip = ids("tile");
  return `<defs><clipPath id="${clip}"><rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${ICON_RADIUS}"/></clipPath></defs><g clip-path="url(#${clip})">${iconBody(edition, ids)}<rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${ICON_RADIUS}" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="6"/></g>`;
}

/** Full-bleed rounded tile, the shape of the `*-universal-1024.png` exports. */
export function editionIconSvg(edition: IconEdition) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">${iconTile(edition, idFactory())}</svg>`;
}

/** The tile inside the macOS pre-Tahoe safe area, with a soft drop shadow. */
export function editionMacIconSvg(edition: IconEdition) {
  const ids = idFactory();
  const shadow = ids("shadow");
  const radius = (ICON_RADIUS * MAC_BODY) / ICON_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}"><defs><filter id="${shadow}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs><rect x="${MAC_INSET}" y="${MAC_INSET + 10}" width="${MAC_BODY}" height="${MAC_BODY}" rx="${n(radius)}" fill="#000" opacity="0.38" filter="url(#${shadow})"/><svg x="${MAC_INSET}" y="${MAC_INSET}" width="${MAC_BODY}" height="${MAC_BODY}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">${iconTile(edition, ids)}</svg></svg>`;
}
