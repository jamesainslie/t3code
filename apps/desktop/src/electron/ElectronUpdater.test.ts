import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { beforeEach, vi } from "vite-plus/test";

const { autoUpdaterMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: "latest",
    disableDifferentialDownload: false,
    fullChangelog: false,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    checkForUpdatesPromise: null as Promise<null> | null,
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import * as ElectronUpdater from "./ElectronUpdater.ts";

describe("ElectronUpdater", () => {
  beforeEach(() => {
    autoUpdaterMock.allowDowngrade = false;
    autoUpdaterMock.allowPrerelease = false;
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.autoInstallOnAppQuit = true;
    autoUpdaterMock.channel = "latest";
    autoUpdaterMock.disableDifferentialDownload = false;
    autoUpdaterMock.fullChangelog = false;
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.checkForUpdates.mockImplementation(() => Promise.resolve(null));
    autoUpdaterMock.checkForUpdatesPromise = null;
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.downloadUpdate.mockImplementation(() => Promise.resolve([]));
    autoUpdaterMock.on.mockClear();
    autoUpdaterMock.quitAndInstall.mockClear();
    autoUpdaterMock.removeListener.mockClear();
    autoUpdaterMock.setFeedURL.mockClear();
  });

  // Fork: electron-updater never times out a stalled feed request on its own.
  it.effect("abandons a stalled update check so the next check starts fresh", () =>
    Effect.gen(function* () {
      // electron-updater hands every caller the in-flight check until it settles.
      autoUpdaterMock.checkForUpdates.mockImplementation(
        () => autoUpdaterMock.checkForUpdatesPromise ?? Promise.resolve(null),
      );
      autoUpdaterMock.checkForUpdatesPromise = new Promise<null>(() => {});
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "nightly";

      const stalledCheck = yield* updater.checkForUpdates.pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(Duration.minutes(1));
      const error = yield* Fiber.join(stalledCheck);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterCheckForUpdatesError);
      assert.equal(error.channel, "nightly");
      assert.isNull(autoUpdaterMock.checkForUpdatesPromise);

      yield* updater.checkForUpdates;
      assert.equal(autoUpdaterMock.checkForUpdates.mock.calls.length, 2);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );
});
