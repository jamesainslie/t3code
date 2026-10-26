import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type RoadmapCommand,
  type RoadmapItemId,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as GitHubIssueApi from "@lathe/source-control-github/server/GitHubIssueApi";
import * as GitHubRequestPolicy from "@lathe/source-control-github/server/GitHubRequestPolicy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as GitHubAccountSelector from "../../sourceControl/GitHubAccountSelector.ts";
import * as RoadmapGitHubSync from "./RoadmapGitHubSync.ts";
import * as RoadmapLinkTestkit from "./RoadmapLink.testkit.ts";
import * as RoadmapService from "./RoadmapService.ts";

const HOME = EnvironmentId.make("env-home");
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const user = { _tag: "user" } as const;

/** GitHub as a map of issues, with every write recorded and applied. */
function fakeGitHub() {
  const issues = new Map<string, GitHubIssueApi.GitHubIssue>();
  const writes: Array<string> = [];
  let reads = 0;
  let readFailure: GitHubIssueApi.GitHubIssueApiError | null = null;
  let tick = 0;
  const touch = (nodeId: string, change: Partial<GitHubIssueApi.GitHubIssue>) => {
    const current = issues.get(nodeId)!;
    tick += 1;
    issues.set(nodeId, {
      ...current,
      ...change,
      updatedAt: change.updatedAt ?? `2026-10-18T13:00:${String(tick).padStart(2, "0")}Z`,
    });
  };
  const add = (
    number: number,
    overrides: Partial<GitHubIssueApi.GitHubIssue> = {},
  ): GitHubIssueApi.GitHubIssue => {
    const issue: GitHubIssueApi.GitHubIssue = {
      host: "github.com",
      owner: "acme",
      repo: "web",
      number,
      nodeId: `I_${number}`,
      url: `https://github.com/acme/web/issues/${number}`,
      title: `Issue ${number}`,
      closed: false,
      updatedAt: "2026-10-18T11:00:00Z",
      writable: true,
      parentNodeId: null,
      subIssueNodeIds: [],
      blockedByNodeIds: [],
      ...overrides,
    };
    issues.set(issue.nodeId, issue);
    if (issue.parentNodeId !== null) {
      const parent = issues.get(issue.parentNodeId);
      if (parent !== undefined && !parent.subIssueNodeIds.includes(issue.nodeId)) {
        issues.set(parent.nodeId, {
          ...parent,
          subIssueNodeIds: [...parent.subIssueNodeIds, issue.nodeId],
        });
      }
    }
    return issue;
  };
  const read = <A>(answer: () => A) =>
    Effect.suspend(() => {
      reads += 1;
      return readFailure === null ? Effect.succeed(answer()) : Effect.fail(readFailure);
    });
  const write = (entry: string, apply: () => void) =>
    Effect.sync(() => {
      writes.push(entry);
      apply();
    });
  const api = GitHubIssueApi.GitHubIssueApi.of({
    issue: (input) =>
      read(() =>
        [...issues.values()].find(
          (issue) =>
            issue.owner.toLowerCase() === input.owner.toLowerCase() &&
            issue.repo.toLowerCase() === input.repo.toLowerCase() &&
            issue.number === input.number,
        ),
      ).pipe(
        Effect.filterOrFail(
          Predicate.isNotUndefined,
          () =>
            new GitHubRequestPolicy.GitHubApiNotFoundError({
              host: input.host,
              operation: "roadmapIssue",
            }),
        ),
      ),
    issues: (input) => read(() => input.nodeIds.flatMap((nodeId) => issues.get(nodeId) ?? [])),
    setTitle: (input) =>
      write(`title ${input.issueId} ${input.title}`, () =>
        touch(input.issueId, { title: input.title }),
      ),
    setClosed: (input) =>
      write(`${input.closed ? "close" : "reopen"} ${input.issueId}`, () =>
        touch(input.issueId, { closed: input.closed }),
      ),
    setParent: (input) =>
      write(`parent ${input.issueId} ${input.parentId ?? "none"}`, () =>
        touch(input.issueId, { parentNodeId: input.parentId }),
      ),
    setBlockedBy: (input) =>
      write(
        `${input.blocked ? "block" : "unblock"} ${input.issueId} ${input.blockingIssueId}`,
        () => {
          const current = issues.get(input.issueId)!;
          touch(input.issueId, {
            blockedByNodeIds: input.blocked
              ? [...current.blockedByNodeIds, input.blockingIssueId]
              : current.blockedByNodeIds.filter((nodeId) => nodeId !== input.blockingIssueId),
          });
        },
      ),
  });
  return {
    api,
    issues,
    writes,
    add,
    touch,
    reads: () => reads,
    failReads: (error: GitHubIssueApi.GitHubIssueApiError | null) => {
      readFailure = error;
    },
  };
}

const makeLayer = (
  github: ReturnType<typeof fakeGitHub>,
  options: { readonly home?: EnvironmentId | null } = {},
) => {
  const services = Layer.mergeAll(
    RoadmapLinkTestkit.layerNotLinked,
    IdAllocator.layer,
    NodeCrypto.layer,
    ServerSettingsService.layerTest({
      roadmap: { homeEnvironmentId: options.home ?? null, areaByLogin: { "jane-work": "work" } },
    }),
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(HOME),
    }),
    Layer.succeed(GitHubIssueApi.GitHubIssueApi, github.api),
    Layer.mock(GitHubAccountSelector.GitHubAccountSelector)({
      forRepository: () => Effect.succeed({ login: "jane-work", credential: null }),
    }),
  );
  const roadmap = RoadmapService.layer.pipe(
    Layer.provide(services),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  );
  return RoadmapGitHubSync.layer.pipe(Layer.provideMerge(roadmap), Layer.provide(services));
};

const run = <A, E>(
  github: ReturnType<typeof fakeGitHub>,
  body: Effect.Effect<A, E, RoadmapGitHubSync.RoadmapGitHubSync | RoadmapService.RoadmapService>,
  options: { readonly home?: EnvironmentId | null } = {},
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    return yield* body;
  }).pipe(Effect.provide(makeLayer(github, options)));

const services = Effect.all({
  sync: RoadmapGitHubSync.RoadmapGitHubSync,
  roadmap: RoadmapService.RoadmapService,
});

const itemOf = (roadmap: RoadmapService.RoadmapService["Service"], itemId: RoadmapItemId) =>
  roadmap
    .get(itemId)
    .pipe(
      Effect.map((found) => (found._tag === "Some" ? found.value : assert.fail("missing item"))),
    );

const byNumber = (roadmap: RoadmapService.RoadmapService["Service"], number: number) =>
  roadmap
    .list()
    .pipe(
      Effect.map(
        (items) =>
          items.find((item) => item.source?.number === number) ??
          assert.fail(`no item for #${number}`),
      ),
    );

let commandCounter = 0;
const userUpdate = (
  roadmap: RoadmapService.RoadmapService["Service"],
  item: RoadmapWorkItem,
  patch: Extract<RoadmapCommand, { type: "roadmap.item.update" }>["patch"],
) =>
  roadmap.dispatch(
    {
      type: "roadmap.item.update",
      commandId: CommandId.make(`user-${(commandCounter += 1)}`),
      itemId: item.id,
      patch,
    },
    user,
  );

/** An epic #1 with feature #2 (holding story #4) and story #3. */
const tree = () => {
  const github = fakeGitHub();
  github.add(1, { title: "Launch" });
  github.add(2, { parentNodeId: "I_1" });
  github.add(3, { parentNodeId: "I_1", closed: true });
  github.add(4, { parentNodeId: "I_2" });
  return github;
};

const importTree = (sync: RoadmapGitHubSync.RoadmapGitHubSync["Service"]) =>
  sync.importIssue({ url: "https://github.com/acme/web/issues/1", area: "personal" });

describe("RoadmapGitHubSync", () => {
  it.effect("imports an issue with its sub-issue tree", () => {
    const github = tree();
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        const result = yield* importTree(sync);
        assert.equal(result.imported, 4);
        const root = yield* itemOf(roadmap, result.itemId);
        assert.deepInclude(root, { type: "epic", title: "Launch", area: "work", parentId: null });
        assert.deepInclude(root.source!, { number: 1, nodeId: "I_1", writable: true });
        const feature = yield* byNumber(roadmap, 2);
        const story = yield* byNumber(roadmap, 3);
        const leaf = yield* byNumber(roadmap, 4);
        assert.deepInclude(feature, { type: "feature", parentId: root.id, area: null });
        assert.deepInclude(story, { type: "story", parentId: root.id, state: "done" });
        assert.deepInclude(leaf, { type: "story", parentId: feature.id });
        assert.equal(leaf.source!.base.parentNodeId, "I_2");

        // Importing it again, by any URL for the same issue, returns the item.
        assert.deepEqual(yield* sync.importIssue({ url: "https://github.com/ACME/web/issues/1" }), {
          itemId: root.id,
          imported: 0,
        });
      }),
    );
  });

  it.effect(
    "refuses a URL that is not an issue, an issue GitHub lacks, and an environment that is not the home",
    () => {
      const github = tree();
      return Effect.gen(function* () {
        yield* run(
          github,
          Effect.gen(function* () {
            const { sync } = yield* services;
            const notIssue = yield* Effect.flip(
              sync.importIssue({ url: "https://github.com/acme/web/pull/1" }),
            );
            assert.equal(notIssue.code, "invalid_request");
            const missing = yield* Effect.flip(
              sync.importIssue({ url: "https://github.com/acme/web/issues/99" }),
            );
            assert.equal(missing.code, "not_found");
          }),
        );
        yield* run(
          github,
          Effect.gen(function* () {
            const { sync } = yield* services;
            const elsewhere = yield* Effect.flip(importTree(sync));
            assert.equal(elsewhere.code, "roadmap_home_elsewhere");
          }),
          { home: EnvironmentId.make("env-other") },
        );
      });
    },
  );

  it.effect("sets an item done when its issue closes, and in progress when it reopens", () => {
    const github = tree();
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        yield* importTree(sync);
        github.touch("I_2", { closed: true });
        yield* sync.syncNow;
        const closed = yield* byNumber(roadmap, 2);
        assert.equal(closed.state, "done");
        assert.isTrue(closed.source!.base.closed);
        assert.equal(closed.source!.remoteUpdatedAt, github.issues.get("I_2")!.updatedAt);

        github.touch("I_3", { closed: false });
        yield* sync.requestSync((yield* byNumber(roadmap, 3)).id);
        yield* sync.drain;
        assert.equal((yield* byNumber(roadmap, 3)).state, "in-progress");
        assert.deepEqual(github.writes, []);
      }),
    );
  });

  it.effect("closes the issue when its item is done here, and renames it", () => {
    const github = tree();
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        yield* importTree(sync);
        yield* sync.syncNow;
        const item = yield* byNumber(roadmap, 4);
        yield* userUpdate(roadmap, item, { state: "done", title: "Ship the leaf" });
        yield* sync.requestSync(item.id);
        yield* sync.drain;
        assert.deepEqual(github.writes, ["title I_4 Ship the leaf", "close I_4"]);
        const after = yield* byNumber(roadmap, 4);
        assert.deepInclude(after.source!.base, { title: "Ship the leaf", closed: true });

        // Agreed now, so another sweep writes nothing.
        yield* sync.syncNow;
        assert.equal(github.writes.length, 2);
      }),
    );
  });

  it.effect("lets the newer title win a conflict and leaves a sync note", () => {
    const github = tree();
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        yield* importTree(sync);
        // Renamed here at 12:00, then on GitHub at 12:30: GitHub's is newer.
        yield* userUpdate(roadmap, yield* byNumber(roadmap, 2), { title: "Ours" });
        github.touch("I_2", { title: "Theirs", updatedAt: "2026-10-18T12:30:00Z" });
        yield* sync.syncNow;
        const item = yield* byNumber(roadmap, 2);
        assert.equal(item.title, "Theirs");
        assert.deepEqual(github.writes, []);
        const [note] = item.progressNotes;
        assert.deepInclude(note!, { kind: "sync", actor: { _tag: "github" } });
        assert.match(note!.text, /GitHub's title "Theirs" replaced "Ours"/);

        // Renamed on GitHub at 11:30, then here at 12:00: ours is newer and is pushed.
        // #3 is closed, so a plain sweep skips it within fifteen minutes; ask for it.
        const closed = yield* byNumber(roadmap, 3);
        yield* userUpdate(roadmap, closed, { title: "Ours" });
        github.touch("I_3", { title: "Older", updatedAt: "2026-10-18T11:30:00Z" });
        yield* sync.requestSync(closed.id);
        yield* sync.drain;
        assert.equal((yield* byNumber(roadmap, 3)).title, "Ours");
        assert.deepEqual(github.writes, ["title I_3 Ours"]);
        // The same decision on a retried sweep adds no second note.
        yield* sync.syncNow;
        assert.equal((yield* byNumber(roadmap, 2)).progressNotes.length, 1);
      }),
    );
  });

  it.effect("refuses user edits to synced fields of an issue this account cannot write", () => {
    const github = fakeGitHub();
    github.add(7, { writable: false });
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        const { itemId } = yield* sync.importIssue({ url: "https://github.com/acme/web/issues/7" });
        const item = yield* itemOf(roadmap, itemId);
        const refused = yield* Effect.flip(userUpdate(roadmap, item, { title: "Mine" }));
        assert.equal(refused.code, "read_only_source");
        yield* userUpdate(roadmap, item, { priority: "p1" });
        assert.equal((yield* itemOf(roadmap, itemId)).priority, "p1");
      }),
    );
  });

  it.effect("pauses an account GitHub rate-limits until the limit resets", () => {
    const github = tree();
    return run(
      github,
      Effect.gen(function* () {
        const { sync } = yield* services;
        yield* importTree(sync);
        const before = github.reads();
        github.failReads(
          new GitHubRequestPolicy.GitHubApiRateLimitError({
            host: "github.com",
            operation: "roadmapIssues",
            retryAt: NOW + 10 * 60_000,
          }),
        );
        yield* sync.syncNow;
        assert.equal(github.reads(), before + 1);
        yield* TestClock.adjust("5 minutes");
        yield* sync.syncNow;
        assert.equal(github.reads(), before + 1);
        github.failReads(null);
        yield* TestClock.adjust("6 minutes");
        yield* sync.syncNow;
        assert.equal(github.reads(), before + 2);
      }),
    );
  });

  it.effect("imports sub-issues added later under an imported issue", () => {
    const github = tree();
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        yield* importTree(sync);
        github.add(5, { parentNodeId: "I_2", title: "Late arrival" });
        github.add(6, { parentNodeId: "I_5" });
        github.touch("I_2", {});
        yield* sync.syncNow;
        const feature = yield* byNumber(roadmap, 2);
        const late = yield* byNumber(roadmap, 5);
        assert.deepInclude(late, { parentId: feature.id, title: "Late arrival", type: "story" });
        assert.equal((yield* byNumber(roadmap, 6)).parentId, late.id);
      }),
    );
  });

  it.effect(
    "drops the sub-issue link with a note when an item moves under a Lathe-only parent",
    () => {
      const github = tree();
      return run(
        github,
        Effect.gen(function* () {
          const { sync, roadmap } = yield* services;
          yield* importTree(sync);
          yield* roadmap.dispatch(
            {
              type: "roadmap.item.create",
              commandId: CommandId.make("lathe-epic"),
              itemId: "lathe-epic" as RoadmapItemId,
              itemType: "epic",
              title: "Lathe-only",
            },
            user,
          );
          const leaf = yield* byNumber(roadmap, 4);
          yield* roadmap.dispatch(
            {
              type: "roadmap.item.move",
              commandId: CommandId.make("move-leaf"),
              itemId: leaf.id,
              parentId: "lathe-epic" as RoadmapItemId,
            },
            user,
          );
          yield* sync.requestSync(leaf.id);
          yield* sync.drain;
          assert.deepEqual(github.writes, ["parent I_4 none"]);
          const after = yield* byNumber(roadmap, 4);
          assert.isNull(after.source!.base.parentNodeId);
          assert.match(after.progressNotes[0]!.text, /Dropped the sub-issue link to "Issue 2"/);
        }),
      );
    },
  );

  it.effect("links blockers between imported issues on the first sweep", () => {
    const github = fakeGitHub();
    github.add(1);
    github.add(2, { blockedByNodeIds: ["I_1"] });
    return run(
      github,
      Effect.gen(function* () {
        const { sync, roadmap } = yield* services;
        const first = yield* sync.importIssue({ url: "https://github.com/acme/web/issues/1" });
        yield* sync.importIssue({ url: "https://github.com/acme/web/issues/2" });
        yield* sync.drain;
        const blocked = yield* byNumber(roadmap, 2);
        assert.deepEqual(blocked.blockedBy, [first.itemId]);
        assert.deepEqual(blocked.source!.base.blockedByNodeIds, ["I_1"]);
        assert.deepEqual(github.writes, []);
      }),
    );
  });
});
