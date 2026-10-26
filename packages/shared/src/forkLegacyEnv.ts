/**
 * Fork-only. Lathe reads `LATHE_*`; before the rename it read `T3CODE_*`, which installed
 * services, shell profiles and scripts still set. Every process entry moves the old names to the
 * new ones before anything reads its configuration, and warns once so they can be found and
 * fixed. A new name that is already set wins over its old one.
 */
const LEGACY_PREFIXES = ["T3CODE_", "VITE_T3CODE_"] as const;

const latheName = (legacyName: string): string | undefined => {
  for (const prefix of LEGACY_PREFIXES) {
    if (legacyName.startsWith(prefix)) {
      return prefix.replace("T3CODE_", "LATHE_") + legacyName.slice(prefix.length);
    }
  }
  return undefined;
};

export function isLegacyEnvName(name: string): boolean {
  return latheName(name) !== undefined;
}

/** The home variable under its Lathe name or its pre-rename name, as a regex alternation. */
export const HOME_ENV_NAME_PATTERN = "(?:LATHE|T3CODE)_HOME";

/**
 * Moves every `T3CODE_*` variable in `env` to its `LATHE_*` name, removing
 * the old one so children see one spelling. Returns the old names it found.
 */
export function adoptLegacyEnv(env: Record<string, string | undefined>): ReadonlyArray<string> {
  const found: Array<string> = [];
  for (const name of Object.keys(env)) {
    const next = latheName(name);
    if (next === undefined) continue;
    found.push(name);
    if (env[next] === undefined) env[next] = env[name];
    delete env[name];
  }
  return found;
}

export function legacyEnvWarning(found: ReadonlyArray<string>): string | undefined {
  if (found.length === 0) return undefined;
  const renames = found.map((name) => `${name} -> ${latheName(name)}`).join(", ");
  return `Lathe read environment variables under their pre-rename names; rename them: ${renames}.`;
}

/** Adopts the legacy names in `process.env` and emits one deprecation warning. */
export function adoptLegacyProcessEnv(): void {
  const warning = legacyEnvWarning(adoptLegacyEnv(process.env));
  if (warning !== undefined) process.emitWarning(warning, "DeprecationWarning");
}

/**
 * Names a variable is exported under to child processes: the Lathe name and,
 * for scripts written before the rename, its old name.
 */
export function withLegacyExportedNames(
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  const exported: Record<string, string> = { ...env };
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("LATHE_")) exported[`T3CODE_${name.slice("LATHE_".length)}`] = value;
  }
  return exported;
}
