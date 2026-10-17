import { forkBaseDirName } from "@lathe/shared/forkBaseDir";
import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(latheHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(latheHome)) {
    return Option.none();
  }
  const trimmed = latheHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly latheHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.latheHome), () =>
    input.joinPath(input.homeDirectory, forkBaseDirName(input.homeDirectory)),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly latheHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.latheHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
