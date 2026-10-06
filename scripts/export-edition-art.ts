#!/usr/bin/env node

// Renders the fork's edition artwork from `lib/edition-art.ts`:
// - the web strips and gallery icon thumbnails in `apps/web/src/assets/editions/`
// - the desktop icons in `assets/editions/<edition>/`, which the desktop build stages and
//   the running app swaps in when "Match app icon" is on.
// The tartan and blueprint strips stay React components; blueprint reuses the dev icons.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import {
  editionIconSvg,
  editionMacIconSvg,
  editionStripSvg,
  GENERATED_EDITIONS,
  type IconEdition,
} from "./lib/edition-art.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const WEB_OUTPUT_DIRECTORY = "apps/web/src/assets/editions";
const DESKTOP_OUTPUT_DIRECTORY = "assets/editions";
// Gallery thumbnails show at 26px; 128 covers high-density displays.
const WEB_ICON_SIZE = 128;
const ICON_EDITIONS: ReadonlyArray<IconEdition> = ["tartan", ...GENERATED_EDITIONS];

export class EditionArtRenderError extends Schema.TaggedError<EditionArtRenderError>()(
  "EditionArtRenderError",
  { asset: Schema.String, cause: Schema.Defect() },
) {}

const rasterize = (asset: string, input: string | Buffer, size: number) =>
  Effect.tryPromise({
    try: () =>
      sharp(typeof input === "string" ? Buffer.from(input) : input)
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    catch: (cause) => new EditionArtRenderError({ asset, cause }),
  });

const exportEditionArt = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const write = Effect.fn("editionArt.write")(function* (
    relativePath: string,
    contents: string | Uint8Array,
  ) {
    const target = path.join(repositoryRoot, relativePath);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* typeof contents === "string"
      ? fs.writeFileString(target, `${contents}\n`)
      : fs.writeFile(target, contents);
    yield* Console.log(`wrote ${relativePath}`);
  });

  for (const edition of GENERATED_EDITIONS) {
    yield* write(`${WEB_OUTPUT_DIRECTORY}/${edition}.svg`, editionStripSvg(edition));
  }

  for (const edition of ICON_EDITIONS) {
    const universal = editionIconSvg(edition);
    const directory = `${DESKTOP_OUTPUT_DIRECTORY}/${edition}`;
    yield* write(
      `${directory}/${edition}-universal-1024.png`,
      yield* rasterize(edition, universal, 1024),
    );
    yield* write(
      `${directory}/${edition}-macos-1024.png`,
      yield* rasterize(`${edition}-macos`, editionMacIconSvg(edition), 1024),
    );
    const renditions = yield* Effect.forEach(WINDOWS_ICON_SIZES, (size) =>
      rasterize(`${edition}-${size}`, universal, size).pipe(
        Effect.map((contents) => ({ size, contents })),
      ),
    );
    yield* write(`${directory}/${edition}-windows.ico`, encodePngIco(renditions));
    yield* write(
      `${WEB_OUTPUT_DIRECTORY}/${edition}-icon.png`,
      yield* rasterize(`${edition}-web`, universal, WEB_ICON_SIZE),
    );
  }

  const blueprint = yield* fs.readFile(
    path.join(repositoryRoot, BRAND_ASSET_PATHS.developmentUniversalIconPng),
  );
  yield* write(
    `${WEB_OUTPUT_DIRECTORY}/blueprint-icon.png`,
    yield* rasterize("blueprint-web", Buffer.from(blueprint), WEB_ICON_SIZE),
  );
});

if (import.meta.main) {
  exportEditionArt.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
