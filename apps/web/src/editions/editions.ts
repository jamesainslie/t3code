import { DEFAULT_EDITION, type Edition } from "@t3tools/contracts";

import amberIcon from "../assets/editions/amber-icon.png?url";
import amberStrip from "../assets/editions/amber.svg?url";
import blueprintIcon from "../assets/editions/blueprint-icon.png?url";
import glitchIcon from "../assets/editions/glitch-icon.png?url";
import glitchStrip from "../assets/editions/glitch.svg?url";
import horizonIcon from "../assets/editions/horizon-icon.png?url";
import horizonStrip from "../assets/editions/horizon.svg?url";
import latheIcon from "../assets/editions/lathe-icon.png?url";
import latheStrip from "../assets/editions/lathe.svg?url";
import nightCityIcon from "../assets/editions/night-city-icon.png?url";
import nightCityStrip from "../assets/editions/night-city.svg?url";
import rainIcon from "../assets/editions/rain-icon.png?url";
import rainStrip from "../assets/editions/rain.svg?url";
import tartanIcon from "../assets/editions/tartan-icon.png?url";
import traceIcon from "../assets/editions/trace-icon.png?url";
import traceStrip from "../assets/editions/trace.svg?url";

/**
 * A generated edition's artwork: a 2048x96-unit strip from `scripts/export-edition-art.ts`,
 * shown at the container's height. `buttonOffset` is where the send button's circle crops
 * it, in art units, and `ground` fills past the strip's right edge on very wide surfaces.
 */
export interface EditionStrip {
  readonly url: string;
  readonly buttonOffset: number;
  readonly ground: string;
}

export interface EditionDefinition {
  readonly id: Edition;
  readonly label: string;
  readonly description: string;
  /** Tints the send button ring and the open sidebar row when "Use edition accent" is on. */
  readonly accent: string;
  readonly iconUrl: string;
  /** Absent for the tartan and blueprint, which are drawn by their own components. */
  readonly strip?: EditionStrip;
}

/** Every edition in gallery order. The contract owns the ids; this owns their presentation. */
export const EDITIONS: ReadonlyArray<EditionDefinition> = [
  {
    id: "lathe",
    label: "Lathe",
    description: "Turned steel, one ember",
    accent: "#FF5A1F",
    iconUrl: latheIcon,
    strip: { url: latheStrip, buttonOffset: 252, ground: "#16111C" },
  },
  {
    id: "tartan",
    label: "Ainslie Tartan",
    description: "The registered sett, woven",
    accent: "#c8433d",
    iconUrl: tartanIcon,
  },
  {
    id: "blueprint",
    label: "Blueprint",
    description: "Drafting grid and dimensions",
    accent: "#5b9dff",
    iconUrl: blueprintIcon,
  },
  {
    id: "rain",
    label: "Phosphor Rain",
    description: "Green glyph rain, frozen",
    accent: "#35d474",
    iconUrl: rainIcon,
    strip: { url: rainStrip, buttonOffset: 96, ground: "#010603" },
  },
  {
    id: "horizon",
    label: "Neon Horizon",
    description: "Slatted sun, wireframe floor",
    accent: "#ff4fd8",
    iconUrl: horizonIcon,
    strip: { url: horizonStrip, buttonOffset: 188, ground: "#0b0319" },
  },
  {
    id: "night-city",
    label: "Night City",
    description: "Rain, windows, one neon sign",
    accent: "#45e3ff",
    iconUrl: nightCityIcon,
    strip: { url: nightCityStrip, buttonOffset: 185, ground: "#0d1426" },
  },
  {
    id: "trace",
    label: "Trace",
    description: "Copper on solder mask",
    accent: "#5ff2d6",
    iconUrl: traceIcon,
    strip: { url: traceStrip, buttonOffset: 268, ground: "#03120f" },
  },
  {
    id: "amber",
    label: "Amber Terminal",
    description: "P3 phosphor and a boot log",
    accent: "#ffb000",
    iconUrl: amberIcon,
    strip: { url: amberStrip, buttonOffset: 160, ground: "#0f0802" },
  },
  {
    id: "glitch",
    label: "Signal Glitch",
    description: "Charcoal with tear lines",
    accent: "#18e6ff",
    iconUrl: glitchIcon,
    strip: { url: glitchStrip, buttonOffset: 96, ground: "#0c0d12" },
  },
];

const EDITIONS_BY_ID = new Map(EDITIONS.map((edition) => [edition.id, edition]));

export function isEdition(value: string | null): value is Edition {
  return value !== null && EDITIONS_BY_ID.has(value as Edition);
}

export function getEdition(id: Edition): EditionDefinition {
  return EDITIONS_BY_ID.get(id) ?? EDITIONS_BY_ID.get(DEFAULT_EDITION)!;
}
