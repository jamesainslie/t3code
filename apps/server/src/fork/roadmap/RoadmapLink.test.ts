import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type RoadmapCommand,
  RoadmapItemId,
  ThreadId,
} from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as RoadmapLink from "./RoadmapLink.ts";
import * as RoadmapLinkTestkit from "./RoadmapLink.testkit.ts";

const LAPTOP = EnvironmentId.make("env-laptop");
const user = { _tag: "user" } as const;
const agent = {
  _tag: "agent",
  thread: { environmentId: LAPTOP, threadId: ThreadId.make("thread-1") },
  threadTitle: "Fix the build",
} as const;

const create = (itemId: string): RoadmapCommand => ({
  type: "roadmap.item.create",
  commandId: CommandId.make(`create-${itemId}`),
  itemId: RoadmapItemId.make(itemId),
  itemType: "story",
  title: `Story ${itemId}`,
});

/** The linked environment's side: a link service over a memory secret store, wired to the home. */
const makeLinked = Effect.fn("makeLinked")(function* (
  home: RoadmapLinkTestkit.InProcessHome,
  secrets: Record<string, string> = {},
) {
  const memory = RoadmapLinkTestkit.makeMemorySecretStore(secrets);
  const link = yield* RoadmapLink.RoadmapLink.pipe(
    Effect.provide(
      RoadmapLink.layer.pipe(
        Layer.provide(Layer.succeed(ServerSecretStore.ServerSecretStore, memory.store)),
        Layer.provide(RoadmapLinkTestkit.layerHttpClientTo(home)),
      ),
    ),
  );
  return { link, read: memory.read };
});

describe("RoadmapLink", () => {
  it.effect("starts unlinked and refuses to call anywhere", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { link } = yield* makeLinked(home);
      expect(yield* link.isLinked).toBe(false);
      expect(yield* link.status).toEqual({ homeUrl: null, unreachableSince: null });
      const error = yield* Effect.flip(link.snapshot);
      expect(error).toMatchObject({ _tag: "RoadmapLinkUnavailableError", reason: "not_linked" });
      expect(home.paths).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("exchanges a grant minted on the home, keeps the session and reads through it", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      yield* home.roadmap.dispatch(create("a"), user);
      const { link, read } = yield* makeLinked(home);
      const grant = yield* home.linkGrant(LAPTOP);

      yield* link.configure({ homeUrl: "http://home.test/settings?x=1", credential: grant });

      expect(yield* link.isLinked).toBe(true);
      expect((yield* link.status).homeUrl).toBe(RoadmapLinkTestkit.HOME_URL);
      expect(read(RoadmapLink.HOME_URL_SECRET)).toBe(RoadmapLinkTestkit.HOME_URL);
      const session = read(RoadmapLink.HOME_CREDENTIAL_SECRET);
      expect(session).toBeDefined();
      // The one-time grant is spent; the link keeps the session it exchanged for.
      expect(session).not.toBe(grant);
      expect((yield* link.snapshot).items.map((item) => item.id)).toEqual(["a"]);
      expect((yield* link.item(RoadmapItemId.make("a"))).item?.title).toBe("Story a");
    }).pipe(Effect.scoped),
  );

  it.effect("picks up a stored link when it starts", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const first = yield* makeLinked(home);
      yield* first.link.configure({
        homeUrl: RoadmapLinkTestkit.HOME_URL,
        credential: yield* home.linkGrant(LAPTOP),
      });
      const restarted = yield* makeLinked(home, {
        [RoadmapLink.HOME_URL_SECRET]: first.read(RoadmapLink.HOME_URL_SECRET)!,
        [RoadmapLink.HOME_CREDENTIAL_SECRET]: first.read(RoadmapLink.HOME_CREDENTIAL_SECRET)!,
      });
      expect(yield* restarted.link.isLinked).toBe(true);
      expect((yield* restarted.link.snapshot).items).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a bad grant or URL and stays unlinked", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { link, read } = yield* makeLinked(home);
      const rejected = yield* Effect.flip(
        link.configure({ homeUrl: RoadmapLinkTestkit.HOME_URL, credential: "not-a-grant" }),
      );
      expect(rejected).toMatchObject({ _tag: "RoadmapLinkError", reason: "credential_rejected" });
      const badUrl = yield* Effect.flip(
        link.configure({ homeUrl: "ftp://home.test", credential: "anything" }),
      );
      expect(badUrl).toMatchObject({ reason: "invalid_url" });
      home.setReachable(false);
      const unreachable = yield* Effect.flip(
        link.configure({
          homeUrl: RoadmapLinkTestkit.HOME_URL,
          credential: yield* home.linkGrant(LAPTOP),
        }),
      );
      expect(unreachable).toMatchObject({ reason: "unreachable" });
      expect(yield* link.isLinked).toBe(false);
      expect(read(RoadmapLink.HOME_CREDENTIAL_SECRET)).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect("dates unreachability from the first failed call and clears it on an answer", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { link } = yield* makeLinked(home);
      yield* link.configure({
        homeUrl: RoadmapLinkTestkit.HOME_URL,
        credential: yield* home.linkGrant(LAPTOP),
      });
      home.setReachable(false);
      const error = yield* Effect.flip(link.snapshot);
      expect(error).toMatchObject({ _tag: "RoadmapLinkUnavailableError", reason: "unreachable" });
      const since = (yield* link.status).unreachableSince;
      expect(since).toBe("1970-01-01T00:00:00.000Z");
      yield* TestClock.adjust("1 minute");
      yield* Effect.flip(link.snapshot);
      expect((yield* link.status).unreachableSince).toBe(since);

      home.setReachable(true);
      // A refusal is an answer too: the home is reachable.
      const refused = yield* Effect.flip(link.dispatch(create("b"), user));
      expect(refused).toMatchObject({ _tag: "RoadmapError", code: "forbidden_actor" });
      expect((yield* link.status).unreachableSince).toBeNull();
      expect((yield* link.dispatch(create("b"), agent)).itemId).toBe("b");
    }).pipe(Effect.scoped),
  );

  it.effect("reads a link the home revoked as unauthorized", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { link } = yield* makeLinked(home);
      yield* link.configure({
        homeUrl: RoadmapLinkTestkit.HOME_URL,
        credential: yield* home.linkGrant(LAPTOP),
      });
      for (const session of yield* home.auth.listSessions()) {
        yield* home.auth.revokeSession(session.sessionId);
      }
      const error = yield* Effect.flip(link.snapshot);
      expect(error).toMatchObject({ reason: "unauthorized" });
      expect((yield* link.status).unreachableSince).not.toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("forgets the link when cleared", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { link, read } = yield* makeLinked(home);
      yield* link.configure({
        homeUrl: RoadmapLinkTestkit.HOME_URL,
        credential: yield* home.linkGrant(LAPTOP),
      });
      yield* link.configure(null);
      expect(yield* link.isLinked).toBe(false);
      expect(yield* link.status).toEqual({ homeUrl: null, unreachableSince: null });
      expect(read(RoadmapLink.HOME_URL_SECRET)).toBeUndefined();
      expect(read(RoadmapLink.HOME_CREDENTIAL_SECRET)).toBeUndefined();
    }).pipe(Effect.scoped),
  );
});
