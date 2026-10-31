import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopMenuBar from "../../menuBar/DesktopMenuBar.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getMenuBarEnabled = makeIpcMethod({
  channel: IpcChannels.GET_MENU_BAR_ENABLED_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.menuBar.getEnabled")(function* () {
    return (yield* (yield* DesktopAppSettings.DesktopAppSettings).get).menuBarEnabled;
  }),
});

export const setMenuBarEnabled = makeIpcMethod({
  channel: IpcChannels.SET_MENU_BAR_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.menuBar.setEnabled")(function* (enabled) {
    const change = yield* (yield* DesktopAppSettings.DesktopAppSettings).setMenuBarEnabled(enabled);
    yield* (yield* DesktopMenuBar.DesktopMenuBar).setEnabled(change.settings.menuBarEnabled);
    return change.settings.menuBarEnabled;
  }),
});
