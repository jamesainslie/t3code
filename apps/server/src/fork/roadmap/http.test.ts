import { describe, expect, it } from "@effect/vitest";
import {
  AuthRoadmapReadScope,
  CommandId,
  EnvironmentId,
  type RoadmapActor,
  type RoadmapCommand,
  RoadmapItemId,
  ThreadId,
} from "@lathe/contracts";
import * as Effect from "effect/Effect";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as RoadmapLinkTestkit from "./RoadmapLink.testkit.ts";

const LAPTOP = EnvironmentId.make("env-laptop");
const DESKTOP = EnvironmentId.make("env-desktop");
const agentOn = (environmentId: EnvironmentId): RoadmapActor => ({
  _tag: "agent",
  thread: { environmentId, threadId: ThreadId.make("thread-1") },
  threadTitle: "Fix the build",
});

const create = (itemId: string, fields: Partial<RoadmapCommand> = {}): RoadmapCommand =>
  ({
    type: "roadmap.item.create",
    commandId: CommandId.make(`create-${itemId}`),
    itemId: RoadmapItemId.make(itemId),
    itemType: "story",
    title: `Story ${itemId}`,
    ...fields,
  }) as RoadmapCommand;

/** The in-process home, called with raw requests to see statuses and bodies. */
const makeHome = Effect.fn("makeRoadmapHome")(function* (
  options: { readonly homeEnvironmentId?: EnvironmentId | null } = {},
) {
  const home = yield* RoadmapLinkTestkit.makeInProcessHome(options);
  const linkToken = (environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      const grant = yield* home.linkGrant(environmentId);
      const exchanged = yield* RoadmapLinkTestkit.issueOnLiveClock(
        home.auth.exchangeBootstrapCredentialForAccessToken(grant, undefined, {
          deviceType: "bot",
        }),
      );
      return exchanged.access_token;
    });
  const request = (
    path: string,
    token: string | null,
    body?: unknown,
  ): Effect.Effect<{ readonly status: number; readonly json: any }> =>
    Effect.promise(async () => {
      const response = await home.handler(
        new Request(`http://localhost${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      const text = await response.text();
      return { status: response.status, json: text.length === 0 ? null : JSON.parse(text) };
    });
  return { auth: home.auth, roadmap: home.roadmap, linkToken, request };
});

describe("roadmap HTTP API", () => {
  it.effect("serves a link session and refuses every other credential", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      yield* home.roadmap.dispatch(create("a"), { _tag: "user" });
      const token = yield* home.linkToken(LAPTOP);

      const snapshot = yield* home.request("/api/roadmap/snapshot", token);
      expect(snapshot.status).toBe(200);
      expect(snapshot.json.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
      expect(snapshot.json.areas.work.unit).toBe("points");

      const administrative = yield* RoadmapLinkTestkit.issueOnLiveClock(home.auth.issueSession());
      expect((yield* home.request("/api/roadmap/snapshot", administrative.token)).status).toBe(401);
      expect((yield* home.request("/api/roadmap/snapshot", null)).status).toBe(401);
    }).pipe(Effect.scoped),
  );

  it.effect("reads one item with its history, and a thread's item with its context", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const thread = { environmentId: LAPTOP, threadId: ThreadId.make("thread-1") };
      yield* home.roadmap.dispatch(create("mine", { attachThread: thread }), { _tag: "user" });
      const token = yield* home.linkToken(LAPTOP);

      const item = yield* home.request("/api/roadmap/items/mine", token);
      expect(item.status).toBe(200);
      expect(item.json.item.title).toBe("Story mine");
      expect(
        item.json.history.map((entry: { event: { type: string } }) => entry.event.type),
      ).toEqual(["roadmap.item.created"]);
      const missing = yield* home.request("/api/roadmap/items/nothing", token);
      expect(missing.json).toEqual({ item: null, history: [] });

      const context = yield* home.request("/api/roadmap/for-thread", token, { thread });
      expect(context.status).toBe(200);
      expect(context.json.items.map((entry: { id: string }) => entry.id)).toEqual(["mine"]);
      expect(context.json.context).toContain('Story "Story mine" (id mine)');
    }).pipe(Effect.scoped),
  );

  it.effect("applies writes only for agents on the environment the link speaks for", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const token = yield* home.linkToken(LAPTOP);

      const accepted = yield* home.request("/api/roadmap/dispatch", token, {
        command: create("from-laptop"),
        actor: agentOn(LAPTOP),
      });
      expect(accepted.status).toBe(200);
      expect(accepted.json.itemId).toBe("from-laptop");
      expect(yield* home.roadmap.get(RoadmapItemId.make("from-laptop"))).toMatchObject({
        _tag: "Some",
      });

      for (const actor of [agentOn(DESKTOP), { _tag: "user" }, { _tag: "github" }]) {
        const refused = yield* home.request("/api/roadmap/dispatch", token, {
          command: create(`refused-${actor._tag}`),
          actor,
        });
        expect(refused.status).toBe(409);
        expect(refused.json).toMatchObject({ _tag: "RoadmapError", code: "forbidden_actor" });
      }
      // A note, since the planner keeps the steward to ticks and notes.
      const steward = yield* home.request("/api/roadmap/dispatch", token, {
        command: {
          type: "roadmap.note.add",
          commandId: "cmd-steward-note",
          itemId: "from-laptop",
          noteId: "steward-note",
          kind: "unsure",
          text: "No test covers this yet.",
        },
        actor: { _tag: "steward", environmentId: LAPTOP },
      });
      expect(steward.status).toBe(200);
    }).pipe(Effect.scoped),
  );

  it.effect("replays a repeated write instead of applying it twice", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const token = yield* home.linkToken(LAPTOP);
      const body = { command: create("once"), actor: agentOn(LAPTOP) };
      const first = yield* home.request("/api/roadmap/dispatch", token, body);
      const second = yield* home.request("/api/roadmap/dispatch", token, body);
      expect(second.json).toEqual(first.json);
      const item = yield* home.request("/api/roadmap/items/once", token);
      expect(item.json.history).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("needs roadmap:write to change anything", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const readOnly = yield* RoadmapLinkTestkit.issueOnLiveClock(
        home.auth.issueSession({
          subject: EnvironmentAuth.roadmapLinkSubject(LAPTOP),
          scopes: [AuthRoadmapReadScope],
        }),
      );
      expect((yield* home.request("/api/roadmap/snapshot", readOnly.token)).status).toBe(200);
      const refused = yield* home.request("/api/roadmap/dispatch", readOnly.token, {
        command: create("nope"),
        actor: agentOn(LAPTOP),
      });
      expect(refused.status).toBe(403);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses when this environment is not the home, so links never chain", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({ homeEnvironmentId: EnvironmentId.make("env-elsewhere") });
      const token = yield* home.linkToken(LAPTOP);
      const refused = yield* home.request("/api/roadmap/snapshot", token);
      expect(refused.status).toBe(409);
      expect(refused.json).toMatchObject({ code: "roadmap_home_elsewhere" });
    }).pipe(Effect.scoped),
  );
});
