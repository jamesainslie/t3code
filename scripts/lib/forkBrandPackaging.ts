/**
 * Fork-only. Rebrands packaging files no bundler sees: the staged desktop
 * resources (DMG background, AppStream metadata), the GNOME extension, the
 * staged package.json that electron-builder turns into Info.plist, desktop
 * entries and .deb metadata, and the npm packages' manifests and READMEs.
 * Upstream's build scripts call it in one line after staging those files.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { rebrandPlainText, rebrandSource } from "./forkBrand.ts";

/** Plain-text formats, rebranded with the phrase rules only: JSON keys and values are not prose. */
const PLAIN_TEXT = /\.(?:json|svg|xml|md|desktop|plist|txt)$/;
/** Scripts, rebranded in their string literals like bundled source. */
const SCRIPT = /\.(?:js|mjs|cjs)$/;

const rebrandFile = Effect.fn("rebrandFile")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!PLAIN_TEXT.test(file) && !SCRIPT.test(file)) return;
  const text = yield* fs.readFileString(file);
  const rebranded = SCRIPT.test(file)
    ? rebrandSource(text, file).code
    : rebrandPlainText(text).text;
  if (rebranded !== text) yield* fs.writeFileString(file, rebranded);
});

/**
 * Rebrands each staged file, and every file under each staged directory, in
 * place. Other file types, such as images and shell scripts, and missing paths
 * are left alone.
 */
export const rebrandStagedFiles = Effect.fn("rebrandStagedFiles")(function* (
  paths: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const target of paths) {
    if (!(yield* fs.exists(target))) continue;
    if ((yield* fs.stat(target)).type !== "Directory") {
      yield* rebrandFile(target);
      continue;
    }
    for (const entry of yield* fs.readDirectory(target, { recursive: true })) {
      const file = path.join(target, entry);
      if ((yield* fs.stat(file)).type === "File") yield* rebrandFile(file);
    }
  }
});
