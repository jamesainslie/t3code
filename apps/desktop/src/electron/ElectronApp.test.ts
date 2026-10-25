import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

const {
  appendSwitchMock,
  autoUpdaterOnMock,
  autoUpdaterRemoveListenerMock,
  exitMock,
  getAppPathMock,
  getSystemLocaleMock,
  getVersionMock,
  onMock,
  quitMock,
  relaunchMock,
  removeListenerMock,
  removeSwitchMock,
  setAboutPanelOptionsMock,
  setAppUserModelIdMock,
  setAsDefaultProtocolClientMock,
  setDesktopNameMock,
  setDockIconMock,
  emptyImage,
  setNameMock,
  setPathMock,
  whenReadyMock,
} = vi.hoisted(() => ({
  appendSwitchMock: vi.fn(),
  autoUpdaterOnMock: vi.fn(),
  autoUpdaterRemoveListenerMock: vi.fn(),
  exitMock: vi.fn(),
  getAppPathMock: vi.fn(() => "/app"),
  getSystemLocaleMock: vi.fn(() => "en-GB"),
  getVersionMock: vi.fn(() => "1.2.3"),
  onMock: vi.fn(),
  quitMock: vi.fn(),
  relaunchMock: vi.fn(),
  removeListenerMock: vi.fn(),
  removeSwitchMock: vi.fn(),
  setAboutPanelOptionsMock: vi.fn(),
  setAppUserModelIdMock: vi.fn(),
  setAsDefaultProtocolClientMock: vi.fn(() => true),
  setDesktopNameMock: vi.fn(),
  setDockIconMock: vi.fn(),
  emptyImage: { isEmpty: () => true },
  setNameMock: vi.fn(),
  setPathMock: vi.fn(),
  whenReadyMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("electron", () => ({
  nativeImage: {
    createEmpty: () => emptyImage,
  },
  autoUpdater: {
    on: autoUpdaterOnMock,
    removeListener: autoUpdaterRemoveListenerMock,
  },
  app: {
    commandLine: {
      appendSwitch: appendSwitchMock,
      removeSwitch: removeSwitchMock,
    },
    dock: {
      setIcon: setDockIconMock,
    },
    getAppPath: getAppPathMock,
    getSystemLocale: getSystemLocaleMock,
    getVersion: getVersionMock,
    isPackaged: true,
    name: "Lathe",
    on: onMock,
    quit: quitMock,
    relaunch: relaunchMock,
    removeListener: removeListenerMock,
    runningUnderARM64Translation: false,
    setAboutPanelOptions: setAboutPanelOptionsMock,
    setAsDefaultProtocolClient: setAsDefaultProtocolClientMock,
    setAppUserModelId: setAppUserModelIdMock,
    setDesktopName: setDesktopNameMock,
    setName: setNameMock,
    setPath: setPathMock,
    whenReady: whenReadyMock,
    exit: exitMock,
  },
}));

import * as ElectronApp from "./ElectronApp.ts";

// Fork: the stage artwork edition resets the dock icon.
describe("ElectronApp", () => {
  it.effect("resets the dock icon with an empty image", () =>
    Effect.gen(function* () {
      setDockIconMock.mockClear();
      const electronApp = yield* ElectronApp.ElectronApp;
      yield* electronApp.resetDockIcon;

      assert.deepEqual(setDockIconMock.mock.calls, [[emptyImage]]);
    }).pipe(Effect.provide(ElectronApp.layer)),
  );
});
