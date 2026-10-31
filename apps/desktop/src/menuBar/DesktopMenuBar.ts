import { promptLinkDeepLink } from "@lathe/shared/promptLinks";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Socket from "effect/socket/Socket";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopWebLinks from "../app/DesktopWebLinks.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { MENU_BAR_ICONS } from "./menuBarIcons.ts";
import { menuBarMenu, type MenuBarAction, type MenuBarMenuEntry } from "./menuBarMenu.ts";
import { startMenuBarFeed } from "./MenuBarFeed.ts";
import {
  summarizeMenuBar,
  type MenuBarEnvironment,
  type MenuBarSummary,
} from "./menuBarSummary.ts";

export class DesktopMenuBar extends Context.Service<
  DesktopMenuBar,
  {
    /** Shows the icon when the saved setting allows it. Call once Electron is ready. */
    readonly initialize: Effect.Effect<void>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void>;
  }
>()("@lathe/desktop/menuBar/DesktopMenuBar") {}

function trayImage(icon: MenuBarSummary["icon"]): Electron.NativeImage {
  const image = Electron.nativeImage.createEmpty();
  image.addRepresentation({ scaleFactor: 1, dataURL: MENU_BAR_ICONS[icon].x1 });
  image.addRepresentation({ scaleFactor: 2, dataURL: MENU_BAR_ICONS[icon].x2 });
  image.setTemplateImage(true);
  return image;
}

const TOOLTIPS: Record<MenuBarSummary["icon"], string> = {
  idle: "Lathe",
  working: "Lathe: agents are working",
  attention: "Lathe: a thread needs you",
};

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const settings = yield* DesktopAppSettings.DesktopAppSettings;
  if (environment.platform !== "darwin") {
    return DesktopMenuBar.of({
      initialize: Effect.void,
      setEnabled: Effect.fn("desktop.menuBar.setEnabled")(function* () {}),
    });
  }
  const feedContext =
    yield* Effect.context<
      Exclude<
        Effect.Services<ReturnType<typeof startMenuBarFeed>>,
        Scope.Scope | Socket.WebSocketConstructor
      >
    >();
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
  const electronApp = yield* ElectronApp.ElectronApp;
  const lock = yield* Semaphore.make(1);
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  let active: Scope.Closeable | null = null;

  const openLink = (appPath: string) =>
    desktopWindow.revealOrCreateMain.pipe(
      Effect.andThen(webLinks.receive(promptLinkDeepLink(appPath))),
    );

  const perform = (action: MenuBarAction) => {
    const effect = (() => {
      switch (action._tag) {
        case "open-thread":
          return openLink(`/${action.environmentId}/${action.threadId}`);
        case "new-thread":
          return openLink("/new");
        case "open-app":
          return desktopWindow.revealOrCreateMain.pipe(Effect.asVoid);
        case "quit":
          return electronApp.quit;
      }
    })();
    runFork(
      effect.pipe(
        Effect.catchCause((cause) => Effect.logWarning("menu bar action failed", cause)),
        Effect.withSpan("desktop.menuBar.action", { attributes: { action: action._tag } }),
      ),
    );
  };

  const toElectronMenu = (entries: ReadonlyArray<MenuBarMenuEntry>) =>
    Electron.Menu.buildFromTemplate(
      entries.map((entry) => {
        if (entry.type === "separator") return { type: "separator" };
        const { action } = entry;
        return {
          label: entry.label,
          ...(entry.sublabel === undefined ? {} : { sublabel: entry.sublabel }),
          enabled: entry.enabled,
          ...(action === undefined ? {} : { click: () => perform(action) }),
        };
      }),
    );

  const start = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const environments = yield* startMenuBarFeed().pipe(
      Effect.provide(Socket.layerWebSocketConstructorGlobal),
      Effect.provideService(Scope.Scope, scope),
      Effect.provide(feedContext),
    );
    let icon: MenuBarSummary["icon"] = "idle";
    const tray = new Electron.Tray(trayImage(icon));
    tray.setToolTip(TOOLTIPS[icon]);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => tray.destroy()),
    );

    const summarize = (current: ReadonlyMap<string, MenuBarEnvironment>) =>
      summarizeMenuBar([...current.values()], DateTime.formatIso(DateTime.nowUnsafe()));
    // Built on click so elapsed times are fresh and nothing rebuilds while the menu is closed.
    const openMenu = () => {
      const current = SubscriptionRef.getUnsafe(environments);
      const now = DateTime.formatIso(DateTime.nowUnsafe());
      tray.popUpContextMenu(toElectronMenu(menuBarMenu(summarize(current), now, current.size > 1)));
    };
    tray.on("click", openMenu);
    tray.on("right-click", openMenu);

    yield* SubscriptionRef.changes(environments).pipe(
      Stream.debounce(Duration.millis(250)),
      Stream.runForEach((current) =>
        Effect.sync(() => {
          const next = summarize(current).icon;
          if (next === icon) return;
          icon = next;
          tray.setImage(trayImage(next));
          tray.setToolTip(TOOLTIPS[next]);
        }),
      ),
      Effect.forkIn(scope),
    );
    active = scope;
  }).pipe(Effect.withSpan("desktop.menuBar.start"));

  const stop = Effect.suspend(() => {
    const scope = active;
    active = null;
    return scope === null ? Effect.void : Scope.close(scope, Exit.void);
  });

  const setEnabled = Effect.fn("desktop.menuBar.setEnabled")(function* (enabled: boolean) {
    yield* lock.withPermit(enabled ? (active === null ? start : Effect.void) : stop);
  });

  yield* Effect.addFinalizer(() => stop);

  return DesktopMenuBar.of({
    initialize: settings.get.pipe(Effect.flatMap((current) => setEnabled(current.menuBarEnabled))),
    setEnabled,
  });
});

export const layer = Layer.effect(DesktopMenuBar, make);
