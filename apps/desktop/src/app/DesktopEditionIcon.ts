import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { type ClientSettings, DEFAULT_CLIENT_SETTINGS, type Edition } from "@t3tools/contracts";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

export type EditionIconSettings = Pick<ClientSettings, "edition" | "editionAppIcon">;

/**
 * Where an edition's icon lives: a staged resource in packaged builds (resolved
 * through DesktopAssets.resolveResourcePath), the repo's assets otherwise.
 */
export type EditionIconLocation =
  | { readonly _tag: "Resource"; readonly fileName: string }
  | { readonly _tag: "SourceTree"; readonly path: string };

const editionIconFileNames = (platform: NodeJS.Platform) =>
  platform === "darwin"
    ? { resource: "macos.png", source: "macos-1024.png" }
    : platform === "win32"
      ? { resource: "windows.ico", source: "windows.ico" }
      : { resource: "universal.png", source: "universal-1024.png" };

export function resolveEditionIconLocation(input: {
  readonly edition: Edition;
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly rootDir: string;
  readonly path: Path.Path;
}): EditionIconLocation {
  const fileNames = editionIconFileNames(input.platform);
  if (input.isPackaged) {
    return { _tag: "Resource", fileName: `editions/${input.edition}/${fileNames.resource}` };
  }
  // Blueprint is the development brand, so its icons already live in assets/dev.
  const directory =
    input.edition === "blueprint"
      ? input.path.join(input.rootDir, "assets", "dev")
      : input.path.join(input.rootDir, "assets", "editions", input.edition);
  return {
    _tag: "SourceTree",
    path: input.path.join(directory, `${input.edition}-${fileNames.source}`),
  };
}

export class DesktopEditionIcon extends Context.Service<
  DesktopEditionIcon,
  {
    /** Applies the stored client settings. Run once before the first window opens. */
    readonly initialize: Effect.Effect<void>;
    /**
     * Shows the edition's icon in the dock (macOS) or on every window (Windows,
     * Linux). Switching it off restores the bundled icon, but only after this
     * service changed it.
     */
    readonly apply: (settings: EditionIconSettings) => Effect.Effect<void>;
    /** The edition icon in effect, for windows opened after it was applied. */
    readonly iconPath: Effect.Effect<Option.Option<string>>;
  }
>()("@t3tools/desktop/app/DesktopEditionIcon") {}

const { logWarning } = makeComponentLogger("desktop-edition-icon");

const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const appliedRef = yield* Ref.make(Option.none<string>());
  const mutex = yield* Semaphore.make(1);

  const probeIconPath = Effect.fn("desktop.editionIcon.probeIconPath")(function* (
    location: EditionIconLocation,
  ) {
    if (location._tag === "Resource") {
      return yield* assets.resolveResourcePath(location.fileName);
    }
    return (yield* fileSystem.exists(location.path))
      ? Option.some(location.path)
      : Option.none<string>();
  });

  const resolveIconPath = Effect.fn("desktop.editionIcon.resolveIconPath")(function* (
    edition: Edition,
  ) {
    const location = resolveEditionIconLocation({
      edition,
      platform: environment.platform,
      isPackaged: environment.isPackaged,
      rootDir: environment.rootDir,
      path: environment.path,
    });
    const iconPath = yield* probeIconPath(location).pipe(
      Effect.catch((cause) =>
        logWarning("failed to probe edition icon", { edition, cause }).pipe(
          Effect.as(Option.none<string>()),
        ),
      ),
    );
    if (Option.isNone(iconPath)) {
      yield* logWarning("edition icon is missing; keeping the current icon", { edition, location });
    }
    return iconPath;
  });

  const setWindowIcons = (iconPath: string) =>
    electronWindow.syncAllAppearance((window) => Effect.sync(() => window.setIcon(iconPath)));

  const showIcon = (iconPath: string) =>
    environment.platform === "darwin"
      ? electronApp.setDockIcon(iconPath)
      : setWindowIcons(iconPath);

  const restoreBundledIcon = Effect.gen(function* () {
    const iconPaths = yield* assets.iconPaths;
    if (environment.platform === "darwin") {
      // Packaged: the bundle's own icon. Unpackaged: the icon DesktopAppIdentity set.
      if (environment.isPackaged || Option.isNone(iconPaths.png)) {
        return yield* electronApp.resetDockIcon;
      }
      return yield* electronApp.setDockIcon(iconPaths.png.value);
    }
    const bundled = environment.platform === "win32" ? iconPaths.ico : iconPaths.png;
    if (Option.isNone(bundled)) {
      return yield* logWarning("bundled window icon is missing; keeping the edition icon");
    }
    yield* setWindowIcons(bundled.value);
  });

  const apply = Effect.fn("desktop.editionIcon.apply")(function* (settings: EditionIconSettings) {
    yield* mutex.withPermits(1)(
      Effect.gen(function* () {
        const applied = yield* Ref.get(appliedRef);
        if (!settings.editionAppIcon) {
          if (Option.isNone(applied)) return;
          yield* restoreBundledIcon;
          yield* Ref.set(appliedRef, Option.none());
          return;
        }
        const iconPath = yield* resolveIconPath(settings.edition);
        if (Option.isNone(iconPath)) return;
        if (Option.isSome(applied) && applied.value === iconPath.value) return;
        yield* showIcon(iconPath.value);
        yield* Ref.set(appliedRef, iconPath);
      }),
    );
  });

  return DesktopEditionIcon.of({
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) => apply(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS))),
      Effect.catch((cause) =>
        logWarning("failed to read client settings for edition icon", { cause }),
      ),
      Effect.withSpan("desktop.editionIcon.initialize"),
    ),
    apply,
    iconPath: Ref.get(appliedRef),
  });
});

export const layer = Layer.effect(DesktopEditionIcon, make);
