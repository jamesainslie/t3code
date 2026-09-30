import type {
  DesktopSshEnvironmentTarget,
  DesktopSshOutputBatch,
  DesktopSshOutputEntry,
} from "@t3tools/contracts";
import { targetConnectionKey } from "@t3tools/ssh/command";
import type { SshOutputObserverFn } from "@t3tools/ssh/output";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { SSH_ENVIRONMENT_OUTPUT_CHANNEL } from "../ipc/channels.ts";
import { makeSshOutputBuffer, type SshOutputBuffer } from "./sshOutputBuffer.ts";

/**
 * What bringing up each SSH environment printed, kept per target so a reconnecting environment
 * can show why. New lines reach the renderer only while a panel subscribes to that target.
 */
export class DesktopSshOutputLog extends Context.Service<
  DesktopSshOutputLog,
  {
    /** The observer to provide while bringing up `target`. */
    readonly observerFor: (target: DesktopSshEnvironmentTarget) => SshOutputObserverFn;
    /** Records an attempt boundary, such as "Connecting" or "Failed: …". */
    readonly mark: (target: DesktopSshEnvironmentTarget, text: string) => Effect.Effect<void>;
    /** Starts pushing `target`'s new lines and returns what it has so far. */
    readonly subscribe: (
      target: DesktopSshEnvironmentTarget,
    ) => Effect.Effect<DesktopSshOutputBatch>;
    readonly unsubscribe: (target: DesktopSshEnvironmentTarget) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/ssh/DesktopSshOutputLog") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const windows = yield* ElectronWindow.ElectronWindow;
  const buffers = new Map<string, SshOutputBuffer>();
  const subscribers = new Map<string, number>();

  const bufferFor = (key: string) => {
    let buffer = buffers.get(key);
    if (buffer === undefined) {
      buffer = makeSshOutputBuffer();
      buffers.set(key, buffer);
    }
    return buffer;
  };
  const record = (
    target: DesktopSshEnvironmentTarget,
    add: (buffer: SshOutputBuffer, at: string) => ReadonlyArray<DesktopSshOutputEntry>,
  ) =>
    Effect.flatMap(DateTime.now, (now) => {
      const key = targetConnectionKey(target);
      const entries = add(bufferFor(key), DateTime.formatIso(now));
      return entries.length === 0 || (subscribers.get(key) ?? 0) === 0
        ? Effect.void
        : windows.sendAll(SSH_ENVIRONMENT_OUTPUT_CHANNEL, { key, entries });
    });

  return DesktopSshOutputLog.of({
    observerFor: (target) => (chunk) => record(target, (buffer, at) => buffer.append(chunk, at)),
    mark: (target, text) => record(target, (buffer, at) => buffer.mark(text, at)),
    subscribe: (target) =>
      Effect.sync(() => {
        const key = targetConnectionKey(target);
        subscribers.set(key, (subscribers.get(key) ?? 0) + 1);
        return { key, entries: [...bufferFor(key).entries()] };
      }),
    unsubscribe: (target) =>
      Effect.sync(() => {
        const key = targetConnectionKey(target);
        const remaining = (subscribers.get(key) ?? 0) - 1;
        if (remaining > 0) subscribers.set(key, remaining);
        else subscribers.delete(key);
      }),
  });
});

export const layer = Layer.effect(DesktopSshOutputLog, make);
