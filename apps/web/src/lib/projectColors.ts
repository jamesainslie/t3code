import type { ProjectColorKey } from "@t3tools/contracts";

/**
 * Visual classes for a project color. Tailwind purges classes by static-string
 * scan, so every class must appear literally in source — we cannot template
 * `text-${name}-500`. The full enumeration below is the source of truth.
 */
export interface ProjectColorClasses {
  /** Left edge accent bar (3px wide vertical band on the row). */
  readonly accentBarClass: string;
  /** Faint row background tint, layered behind hover/active states. */
  readonly rowTintClass: string;
  /** Filled circular swatch used in the picker submenu and toasts. */
  readonly swatchClass: string;
  /** Solid dot used inline next to the chevron in collapsed group mode. */
  readonly dotClass: string;
}

export interface ProjectColorEntry extends ProjectColorClasses {
  readonly key: ProjectColorKey;
  readonly label: string;
}

const COLOR_TABLE: Record<ProjectColorKey, Omit<ProjectColorEntry, "key">> = {
  slate: {
    label: "Slate",
    accentBarClass: "bg-slate-500",
    rowTintClass: "bg-slate-500/10",
    swatchClass: "bg-slate-500",
    dotClass: "bg-slate-500",
  },
  red: {
    label: "Red",
    accentBarClass: "bg-red-500",
    rowTintClass: "bg-red-500/10",
    swatchClass: "bg-red-500",
    dotClass: "bg-red-500",
  },
  orange: {
    label: "Orange",
    accentBarClass: "bg-orange-500",
    rowTintClass: "bg-orange-500/10",
    swatchClass: "bg-orange-500",
    dotClass: "bg-orange-500",
  },
  amber: {
    label: "Amber",
    accentBarClass: "bg-amber-500",
    rowTintClass: "bg-amber-500/10",
    swatchClass: "bg-amber-500",
    dotClass: "bg-amber-500",
  },
  yellow: {
    label: "Yellow",
    accentBarClass: "bg-yellow-500",
    rowTintClass: "bg-yellow-500/10",
    swatchClass: "bg-yellow-500",
    dotClass: "bg-yellow-500",
  },
  lime: {
    label: "Lime",
    accentBarClass: "bg-lime-500",
    rowTintClass: "bg-lime-500/10",
    swatchClass: "bg-lime-500",
    dotClass: "bg-lime-500",
  },
  green: {
    label: "Green",
    accentBarClass: "bg-green-500",
    rowTintClass: "bg-green-500/10",
    swatchClass: "bg-green-500",
    dotClass: "bg-green-500",
  },
  emerald: {
    label: "Emerald",
    accentBarClass: "bg-emerald-500",
    rowTintClass: "bg-emerald-500/10",
    swatchClass: "bg-emerald-500",
    dotClass: "bg-emerald-500",
  },
  teal: {
    label: "Teal",
    accentBarClass: "bg-teal-500",
    rowTintClass: "bg-teal-500/10",
    swatchClass: "bg-teal-500",
    dotClass: "bg-teal-500",
  },
  cyan: {
    label: "Cyan",
    accentBarClass: "bg-cyan-500",
    rowTintClass: "bg-cyan-500/10",
    swatchClass: "bg-cyan-500",
    dotClass: "bg-cyan-500",
  },
  sky: {
    label: "Sky",
    accentBarClass: "bg-sky-500",
    rowTintClass: "bg-sky-500/10",
    swatchClass: "bg-sky-500",
    dotClass: "bg-sky-500",
  },
  blue: {
    label: "Blue",
    accentBarClass: "bg-blue-500",
    rowTintClass: "bg-blue-500/10",
    swatchClass: "bg-blue-500",
    dotClass: "bg-blue-500",
  },
  indigo: {
    label: "Indigo",
    accentBarClass: "bg-indigo-500",
    rowTintClass: "bg-indigo-500/10",
    swatchClass: "bg-indigo-500",
    dotClass: "bg-indigo-500",
  },
  violet: {
    label: "Violet",
    accentBarClass: "bg-violet-500",
    rowTintClass: "bg-violet-500/10",
    swatchClass: "bg-violet-500",
    dotClass: "bg-violet-500",
  },
  fuchsia: {
    label: "Fuchsia",
    accentBarClass: "bg-fuchsia-500",
    rowTintClass: "bg-fuchsia-500/10",
    swatchClass: "bg-fuchsia-500",
    dotClass: "bg-fuchsia-500",
  },
  pink: {
    label: "Pink",
    accentBarClass: "bg-pink-500",
    rowTintClass: "bg-pink-500/10",
    swatchClass: "bg-pink-500",
    dotClass: "bg-pink-500",
  },
  rose: {
    label: "Rose",
    accentBarClass: "bg-rose-500",
    rowTintClass: "bg-rose-500/10",
    swatchClass: "bg-rose-500",
    dotClass: "bg-rose-500",
  },
};

const PROJECT_COLOR_ORDER: readonly ProjectColorKey[] = [
  "slate",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "pink",
  "rose",
];

export const PROJECT_COLOR_ENTRIES: readonly ProjectColorEntry[] = PROJECT_COLOR_ORDER.map(
  (key) => ({ key, ...COLOR_TABLE[key] }),
);

export function getProjectColorClasses(key: ProjectColorKey): ProjectColorClasses {
  return COLOR_TABLE[key];
}

export function getProjectColorLabel(key: ProjectColorKey): string {
  return COLOR_TABLE[key].label;
}

/**
 * Resolve a stable identity key for a project's color. Uses the repository
 * canonical key when available so the same repo shares one color across local
 * and remote envs (and across grouping-mode toggles); falls back to the
 * physical (env + cwd) key for projects without a known repository.
 */
export function resolveProjectColorIdentityKey(input: {
  readonly repositoryCanonicalKey: string | null | undefined;
  readonly physicalProjectKey: string;
}): string {
  const trimmedCanonical = input.repositoryCanonicalKey?.trim();
  return trimmedCanonical && trimmedCanonical.length > 0
    ? trimmedCanonical
    : input.physicalProjectKey;
}
