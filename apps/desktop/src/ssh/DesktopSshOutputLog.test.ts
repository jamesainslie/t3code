import { assert, describe, it } from "@effect/vitest";
import type { DesktopSshOutputBatch } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { SSH_ENVIRONMENT_OUTPUT_CHANNEL } from "../ipc/channels.ts";
import * as DesktopSshOutputLog from "./DesktopSshOutputLog.ts";

const target = { alias: "devbox", hostname: "devbox.example.com", username: null, port: null };
const other = { ...target, alias: "staging", hostname: "staging.example.com" };

function makeLayer() {
  const sent: Array<DesktopSshOutputBatch> = [];
  const layer = DesktopSshOutputLog.layer.pipe(
    Layer.provide(
      Layer.mock(ElectronWindow.ElectronWindow)({
        sendAll: (channel, batch) =>
          Effect.sync(() => {
            assert.equal(channel, SSH_ENVIRONMENT_OUTPUT_CHANNEL);
            sent.push(batch as DesktopSshOutputBatch);
          }),
      }),
    ),
  );
  return { sent, layer };
}

const texts = (batches: ReadonlyArray<DesktopSshOutputBatch>) =>
  batches.flatMap((batch) => batch.entries.map((entry) => entry.text));

describe("DesktopSshOutputLog", () => {
  it.effect("pushes new lines only while someone is subscribed", () => {
    const { sent, layer } = makeLayer();
    return Effect.gen(function* () {
      const log = yield* DesktopSshOutputLog.DesktopSshOutputLog;
      const observe = log.observerFor(target);

      yield* log.mark(target, "Connecting to devbox");
      yield* observe({ source: "launch", stream: "stderr", text: "installing t3\n" });
      assert.deepEqual(sent, []);

      const snapshot = yield* log.subscribe(target);
      assert.deepEqual(
        snapshot.entries.map((entry) => entry.text),
        ["Connecting to devbox", "installing t3"],
      );

      yield* observe({ source: "tunnel", stream: "stderr", text: "Connection refused\n" });
      yield* log.observerFor(other)({ source: "launch", stream: "stderr", text: "elsewhere\n" });
      assert.deepEqual(texts(sent), ["Connection refused"]);
      assert.equal(sent[0]?.key, snapshot.key);

      yield* log.unsubscribe(target);
      yield* log.mark(target, "Failed: Connection refused");
      assert.equal(sent.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps pushing until every subscriber has left, and keeps the log after", () => {
    const { sent, layer } = makeLayer();
    return Effect.gen(function* () {
      const log = yield* DesktopSshOutputLog.DesktopSshOutputLog;
      yield* log.subscribe(target);
      yield* log.subscribe(target);
      yield* log.unsubscribe(target);
      yield* log.mark(target, "Connected");
      assert.deepEqual(texts(sent), ["Connected"]);

      yield* log.unsubscribe(target);
      // A stray unsubscribe must not let a later subscriber go unheard.
      yield* log.unsubscribe(target);
      const again = yield* log.subscribe(target);
      assert.deepEqual(
        again.entries.map((entry) => entry.text),
        ["Connected"],
      );
      yield* log.mark(target, "Connecting to devbox");
      assert.deepEqual(texts(sent), ["Connected", "Connecting to devbox"]);
    }).pipe(Effect.provide(layer));
  });
});
