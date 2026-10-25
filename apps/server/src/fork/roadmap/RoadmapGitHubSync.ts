/**
 * Fork: roadmap. Imports GitHub issues as work items and keeps them in step
 * with their issues. Only the roadmap home syncs, with its own gh logins: each
 * sweep checks the home first, so moving the home stops sync here at once.
 *
 * The reactor copies the shape of `PullRequestSyncReactor`: one sweep a
 * minute on a drainable worker, open issues every sweep and closed ones every
 * fifteen minutes, a pause per account while GitHub's rate limit holds, and a
 * targeted sweep for an item a user or agent just changed here.
 */
import {
  CommandId,
  type RoadmapArea,
  type RoadmapCommand,
  RoadmapError,
  type RoadmapImportIssueInput,
  type RoadmapImportIssueResult,
  RoadmapItemId,
  type RoadmapIssueLocalChanges,
  type RoadmapIssueSyncBase,
  type RoadmapItemType,
  type RoadmapWorkItem,
  ROADMAP_NO_LOCAL_CHANGES,
} from "@lathe/contracts";
import { parseGitHubIssueUrl } from "@lathe/shared/changeRequestUrl";
import { makeDrainableWorker } from "@lathe/shared/DrainableWorker";
import * as GitHubIssueApi from "@lathe/source-control-github/server/GitHubIssueApi";
import * as GitHubRequestPolicy from "@lathe/source-control-github/server/GitHubRequestPolicy";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../../serverSettings.ts";
import { forkParked } from "../../serverActivation.ts";
import * as GitHubAccountSelector from "../../sourceControl/GitHubAccountSelector.ts";
import {
  type IssueReconciliation,
  issueItemType,
  reconcileIssue,
} from "./RoadmapGitHubReconcile.ts";
import * as RoadmapService from "./RoadmapService.ts";

const CLOSED_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
/** Without a reset time from GitHub, a rate-limited account rests this long. */
const DEFAULT_PAUSE_MS = 60 * 1_000;
/** One import never creates more items than this, however deep the tree. */
const IMPORT_LIMIT = 200;

const github = { _tag: "github" } as const;

export class RoadmapGitHubSync extends Context.Service<
  RoadmapGitHubSync,
  {
    /** Imports the issue at `url` and its sub-issue tree; an issue already imported is returned. */
    readonly importIssue: (
      input: RoadmapImportIssueInput,
    ) => Effect.Effect<RoadmapImportIssueResult, RoadmapError>;
    /** Reads the item's issue in the next requested sweep, even when it is closed. */
    readonly requestSync: (itemId: RoadmapItemId) => Effect.Effect<void>;
    /** Sweeps every item that is due now, and waits for the sweep to finish. */
    readonly syncNow: Effect.Effect<void>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("lathe/fork/roadmap/RoadmapGitHubSync") {}

interface Account {
  readonly login: string | null;
  readonly credential: GitHubAccountSelector.PinnedGitHubCredentialValue | null;
  /** Rate limits are per account, so one paused account never holds up another. */
  readonly pauseKey: string;
}

/** FNV-1a, so a note id stays short however long the note. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** When the account may ask again, for a failure that is GitHub's rate limit. */
function retryAtOf(error: unknown, nowMs: number): number | undefined {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return undefined;
  switch (error._tag) {
    case "GitHubApiRateLimitError":
    case "SourceControlRateLimitPausedError": {
      const retryAt = (error as { readonly retryAt?: number }).retryAt;
      return retryAt ?? nowMs + DEFAULT_PAUSE_MS;
    }
    default:
      return undefined;
  }
}

const sameRepository = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const sameBase = (left: RoadmapIssueSyncBase, right: RoadmapIssueSyncBase) =>
  left.title === right.title &&
  left.closed === right.closed &&
  left.parentNodeId === right.parentNodeId &&
  left.blockedByNodeIds.length === right.blockedByNodeIds.length &&
  left.blockedByNodeIds.every((nodeId, index) => nodeId === right.blockedByNodeIds[index]);

const stampText = (changes: RoadmapIssueLocalChanges) =>
  [changes.title, changes.closed, changes.parent, changes.blockedBy].join("|");

const make = Effect.gen(function* () {
  const roadmap = yield* RoadmapService.RoadmapService;
  const issueApi = yield* GitHubIssueApi.GitHubIssueApi;
  const accounts = yield* GitHubAccountSelector.GitHubAccountSelector;
  const settings = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const lastSyncedAt = new Map<RoadmapItemId, number>();
  const requested = new Set<RoadmapItemId>();
  let requestedSweepQueued = false;
  const pausedUntil = new Map<string, number>();

  const accountFor = (host: string, owner: string) =>
    accounts.forRepository({ host, owner }).pipe(
      Effect.map((selected): Account => ({
        login: selected?.login ?? null,
        credential: selected?.credential ?? null,
        pauseKey: `${host.toLowerCase()}\0${selected?.login ?? ""}`,
      })),
    );

  const asAccount =
    (account: Account) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      account.credential === null
        ? effect
        : Effect.provideService(
            effect,
            GitHubRequestPolicy.PinnedGitHubCredential,
            account.credential,
          );

  const notePause = (account: Account, error: unknown) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((nowMs) => {
        const retryAt = retryAtOf(error, nowMs);
        if (retryAt === undefined) return false;
        pausedUntil.set(
          account.pauseKey,
          Math.max(retryAt, pausedUntil.get(account.pauseKey) ?? 0),
        );
        return true;
      }),
    );

  const commandId = (kind: string, itemId: RoadmapItemId) =>
    crypto.randomUUIDv4().pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`github:${kind}:${itemId}:${uuid}`)),
    );

  const dispatch = (
    build: (commandId: CommandId) => RoadmapCommand,
    kind: string,
    itemId: RoadmapItemId,
  ) => commandId(kind, itemId).pipe(Effect.flatMap((id) => roadmap.dispatch(build(id), github)));

  const sourceOf = (
    issue: GitHubIssueApi.GitHubIssue,
    base: RoadmapIssueSyncBase,
    syncedAt: string,
  ) => ({
    host: issue.host,
    owner: issue.owner,
    repo: issue.repo,
    number: issue.number,
    nodeId: issue.nodeId,
    url: issue.url,
    writable: issue.writable,
    remoteUpdatedAt: issue.updatedAt,
    syncedAt,
    base,
    localChangedAt: ROADMAP_NO_LOCAL_CHANGES,
  });

  /**
   * Creates items for `roots` under `parent`, then for their sub-issues no
   * item holds, breadth first. Roots take `area`; the rest inherit. Returns
   * the ids created, in creation order. With `strict`, a root the planner
   * refuses fails the import; otherwise it is skipped with a log line, as
   * every sub-issue is.
   */
  const importTree = Effect.fn("RoadmapGitHubSync.importTree")(function* (input: {
    readonly roots: ReadonlyArray<GitHubIssueApi.GitHubIssue>;
    readonly parent: RoadmapWorkItem | null;
    readonly area: RoadmapArea | null;
    readonly account: Account;
    readonly known: Set<string>;
    readonly strict: boolean;
  }) {
    const created: Array<RoadmapItemId> = [];
    const syncedAt = DateTime.formatIso(yield* DateTime.now);
    let level: Array<{
      readonly issue: GitHubIssueApi.GitHubIssue;
      readonly parentId: RoadmapItemId | null;
      readonly parentType: RoadmapItemType | null;
      readonly parentNodeId: string | null;
      readonly root: boolean;
    }> = input.roots.map((issue) => ({
      issue,
      parentId: input.parent?.id ?? null,
      parentType: input.parent?.type ?? null,
      parentNodeId: input.parent?.source?.nodeId ?? null,
      root: true,
    }));
    for (const entry of level) input.known.add(entry.issue.nodeId);
    while (level.length > 0 && created.length < IMPORT_LIMIT) {
      const next: typeof level = [];
      for (const { issue, parentId, parentType, parentNodeId, root } of level) {
        if (created.length >= IMPORT_LIMIT) break;
        const itemType = issueItemType(parentType, issue.subIssueNodeIds.length > 0);
        if (itemType === null) {
          if (root && input.strict) {
            return yield* new RoadmapError({
              code: "invalid_parent",
              message: `Issue #${issue.number} cannot sit under ${input.parent === null ? "the top level" : `${input.parent.type} "${input.parent.title}"`}.`,
            });
          }
          yield* Effect.logWarning("roadmap import skipped an issue with no place to go", {
            number: issue.number,
          });
          continue;
        }
        const itemId = RoadmapItemId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
        const imported = yield* dispatch(
          (commandId) => ({
            type: "roadmap.source.import",
            commandId,
            itemId,
            itemType,
            title: issue.title,
            parentId,
            area: root ? input.area : null,
            state: issue.closed ? "done" : "backlog",
            source: sourceOf(
              issue,
              {
                title: issue.title,
                closed: issue.closed,
                parentNodeId,
                // The first sweep links blockers, once every end is an item.
                blockedByNodeIds: [],
              },
              syncedAt,
            ),
          }),
          "import",
          itemId,
        ).pipe(
          Effect.as(true),
          Effect.catchTags({
            RoadmapError: (error) =>
              root && input.strict
                ? Effect.fail(error)
                : Effect.logWarning("roadmap import skipped an issue", {
                    number: issue.number,
                    code: error.code,
                  }).pipe(Effect.as(false)),
          }),
        );
        if (!imported) continue;
        created.push(itemId);
        const children = issue.subIssueNodeIds.filter((nodeId) => !input.known.has(nodeId));
        if (children.length === 0) continue;
        for (const nodeId of children) input.known.add(nodeId);
        const found = yield* issueApi
          .issues({ host: issue.host, nodeIds: children })
          .pipe(asAccount(input.account));
        for (const child of found) {
          next.push({
            issue: child,
            parentId: itemId,
            parentType: itemType,
            parentNodeId: issue.nodeId,
            root: false,
          });
        }
      }
      level = next;
    }
    // Blockers wait for a sweep, which links them once both ends are items.
    for (const itemId of created) requested.add(itemId);
    return created;
  });

  const readFailure = (error: GitHubIssueApi.GitHubIssueApiError, label: string) =>
    error._tag === "GitHubApiNotFoundError"
      ? new RoadmapError({
          code: "not_found",
          message: `GitHub shows no issue ${label}, or this environment's account for it cannot see it.`,
        })
      : error._tag === "GitHubApiRateLimitError" ||
          error._tag === "SourceControlRateLimitPausedError"
        ? new RoadmapError({
            code: "internal",
            message: "GitHub's rate limit is in effect for this account. Try again later.",
          })
        : new RoadmapError({ code: "internal", message: `Could not read ${label} from GitHub.` });

  const importIssue: RoadmapGitHubSync["Service"]["importIssue"] = Effect.fn(
    "RoadmapGitHubSync.importIssue",
  )(function* (input) {
    if (!(yield* roadmap.isHome)) {
      return yield* new RoadmapError({
        code: "roadmap_home_elsewhere",
        message: "GitHub issues import on the roadmap home, which is another environment.",
      });
    }
    const link = parseGitHubIssueUrl(input.url);
    if (link === null) {
      return yield* new RoadmapError({
        code: "invalid_request",
        message: "That is not a GitHub issue URL, such as https://github.com/owner/repo/issues/12.",
      });
    }
    const label = `${link.owner}/${link.repo}#${link.number}`;
    const records = yield* roadmap.localRecords();
    const live = records.flatMap((record) => (record.deletedAt === null ? [record.item] : []));
    const held = (match: (source: NonNullable<RoadmapWorkItem["source"]>) => boolean) =>
      live.find((item) => item.source !== null && match(item.source));
    const existing = held(
      (source) =>
        source.host === link.host &&
        sameRepository(source.owner, link.owner) &&
        sameRepository(source.repo, link.repo) &&
        source.number === link.number,
    );
    if (existing !== undefined) return { itemId: existing.id, imported: 0 };

    const parentId = input.parentId ?? null;
    const parent = parentId === null ? null : (live.find((item) => item.id === parentId) ?? null);
    if (parentId !== null && parent === null) {
      return yield* new RoadmapError({ code: "not_found", message: `No work item ${parentId}.` });
    }
    const account = yield* accountFor(link.host, link.owner);
    const root = yield* issueApi.issue(link).pipe(
      asAccount(account),
      Effect.mapError((error) => readFailure(error, label)),
    );
    // A transferred issue answers at its old URL under its new home.
    const moved = held((source) => source.nodeId === root.nodeId);
    if (moved !== undefined) return { itemId: moved.id, imported: 0 };

    const areaByLogin = (yield* settings.getSettings.pipe(
      Effect.mapError(
        () => new RoadmapError({ code: "internal", message: "Could not read settings." }),
      ),
    )).roadmap.areaByLogin;
    const area =
      (account.login === null ? undefined : areaByLogin[account.login]) ?? input.area ?? null;
    const known = new Set(
      records.flatMap((record) => (record.item.source === null ? [] : [record.item.source.nodeId])),
    );
    const created = yield* importTree({
      roots: [root],
      parent,
      area,
      account,
      known,
      strict: true,
    }).pipe(
      Effect.mapError((error) =>
        error._tag === "RoadmapError" ? error : readFailure(error, `the sub-issues of ${label}`),
      ),
    );
    yield* requestSweep;
    // Strict: the root is created or the import failed above.
    return { itemId: created[0]!, imported: created.length };
  });

  /** Applies one reconciliation; records the agreement only when every change landed. */
  const apply = Effect.fn("RoadmapGitHubSync.apply")(function* (
    item: RoadmapWorkItem,
    remote: GitHubIssueApi.GitHubIssue,
    result: IssueReconciliation,
    account: Account,
  ) {
    let complete = true;
    const local = (build: (commandId: CommandId) => RoadmapCommand, kind: string) =>
      dispatch(build, kind, item.id).pipe(
        Effect.catchTags({
          RoadmapError: (error) => {
            complete = false;
            return Effect.logWarning("roadmap sync could not apply a GitHub change", {
              itemId: item.id,
              kind,
              code: error.code,
            });
          },
        }),
      );
    for (const change of result.local) {
      switch (change.kind) {
        case "title":
        case "state":
          yield* local(
            (commandId) => ({
              type: "roadmap.item.update",
              commandId,
              itemId: item.id,
              patch: change.kind === "title" ? { title: change.title } : { state: change.state },
            }),
            change.kind,
          );
          break;
        case "move":
          if (change.itemType !== undefined || change.area !== undefined) {
            yield* local(
              (commandId) => ({
                type: "roadmap.item.update",
                commandId,
                itemId: item.id,
                patch: {
                  ...(change.itemType === undefined ? {} : { type: change.itemType }),
                  ...(change.area === undefined ? {} : { area: change.area }),
                },
              }),
              "retype",
            );
          }
          yield* local(
            (commandId) => ({
              type: "roadmap.item.move",
              commandId,
              itemId: item.id,
              parentId: change.parentId,
            }),
            "move",
          );
          break;
        case "blocker":
          yield* local(
            (commandId) => ({
              type: change.linked ? "roadmap.blocker.link" : "roadmap.blocker.unlink",
              commandId,
              itemId: item.id,
              blockedById: change.blockedById,
            }),
            "blocker",
          );
          break;
      }
    }
    for (const entry of result.notes) {
      yield* roadmap
        .dispatch(
          {
            type: "roadmap.note.add",
            commandId: CommandId.make(`github:note:${item.id}:${hash(entry.key)}`),
            itemId: item.id,
            noteId: `github:${hash(entry.key)}`,
            kind: "sync",
            text: entry.text,
          },
          github,
        )
        .pipe(Effect.ignore);
    }
    const host = remote.host;
    for (const change of result.remote) {
      const push =
        change.kind === "title"
          ? issueApi.setTitle({ host, issueId: remote.nodeId, title: change.title })
          : change.kind === "closed"
            ? issueApi.setClosed({ host, issueId: remote.nodeId, closed: change.closed })
            : change.kind === "parent"
              ? issueApi.setParent({
                  host,
                  issueId: remote.nodeId,
                  parentId: change.parentNodeId,
                  previousParentId: change.previousParentNodeId,
                })
              : issueApi.setBlockedBy({
                  host,
                  issueId: remote.nodeId,
                  blockingIssueId: change.blockingNodeId,
                  blocked: change.blocked,
                });
      const pushed = yield* push.pipe(
        asAccount(account),
        Effect.as(true),
        Effect.catch((error) =>
          notePause(account, error).pipe(
            Effect.andThen(
              Effect.logWarning("roadmap sync could not update an issue", {
                itemId: item.id,
                change: change.kind,
                error: error._tag,
              }),
            ),
            Effect.as(false),
          ),
        ),
      );
      // A failed push leaves the old agreement, so the next sweep tries again.
      if (!pushed) complete = false;
    }
    const source = item.source!;
    const unchanged =
      source.writable === remote.writable &&
      source.remoteUpdatedAt === remote.updatedAt &&
      sameBase(source.base, result.base);
    if (!complete || unchanged) return complete;
    yield* local(
      (commandId) => ({
        type: "roadmap.source.sync",
        commandId,
        itemId: item.id,
        writable: remote.writable,
        remoteUpdatedAt: remote.updatedAt,
        base: result.base,
      }),
      "sync",
    );
    return complete;
  });

  const sweep = Effect.fn("RoadmapGitHubSync.sweep")(function* (scope: "all" | "requested") {
    if (!(yield* roadmap.isHome)) return;
    const records = yield* roadmap.localRecords();
    const live = records.flatMap((record) => (record.deletedAt === null ? [record.item] : []));
    const items = new Map(live.map((item) => [item.id, item]));
    const byNodeId = new Map(
      live.flatMap((item) => (item.source === null ? [] : [[item.source.nodeId, item] as const])),
    );
    const known = new Set(
      records.flatMap((record) => (record.item.source === null ? [] : [record.item.source.nodeId])),
    );
    for (const itemId of lastSyncedAt.keys()) if (!items.has(itemId)) lastSyncedAt.delete(itemId);
    for (const itemId of requested) if (!items.has(itemId)) requested.delete(itemId);

    const nowMs = yield* Clock.currentTimeMillis;
    const isDue = (item: RoadmapWorkItem) => {
      if (requested.has(item.id)) return true;
      if (scope === "requested") return false;
      if (!item.source!.base.closed) return true;
      const last = lastSyncedAt.get(item.id);
      return last === undefined || nowMs - last >= CLOSED_SYNC_INTERVAL_MS;
    };
    const groups = new Map<string, Array<RoadmapWorkItem>>();
    for (const item of byNodeId.values()) {
      if (!isDue(item)) continue;
      const key = `${item.source!.host}\0${item.source!.owner.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }

    const discovered: Array<{
      readonly parent: RoadmapWorkItem;
      readonly nodeIds: ReadonlyArray<string>;
      readonly account: Account;
    }> = [];
    for (const group of groups.values()) {
      const first = group[0]!.source!;
      const account = yield* accountFor(first.host, first.owner);
      if ((pausedUntil.get(account.pauseKey) ?? 0) > (yield* Clock.currentTimeMillis)) continue;
      const remotes = yield* issueApi
        .issues({ host: first.host, nodeIds: group.map((item) => item.source!.nodeId) })
        .pipe(
          asAccount(account),
          Effect.catch((error) =>
            notePause(account, error).pipe(
              Effect.tap((paused) =>
                paused
                  ? Effect.void
                  : Effect.logWarning("roadmap sync could not read issues", {
                      host: first.host,
                      owner: first.owner,
                      error: error._tag,
                    }),
              ),
              Effect.as(null),
            ),
          ),
        );
      if (remotes === null) continue;
      const byRemoteId = new Map(remotes.map((remote) => [remote.nodeId, remote]));
      for (const item of group) {
        const remote = byRemoteId.get(item.source!.nodeId);
        if (remote === undefined) {
          // Deleted, transferred or hidden from this account: leave the item as it is.
          requested.delete(item.id);
          continue;
        }
        const result = reconcileIssue({ item, remote, items, byNodeId, knownNodeIds: known });
        const complete = yield* apply(item, remote, result, account);
        lastSyncedAt.set(item.id, nowMs);
        if (complete) requested.delete(item.id);
        if (result.newSubIssues.length > 0) {
          for (const nodeId of result.newSubIssues) known.add(nodeId);
          discovered.push({ parent: item, nodeIds: result.newSubIssues, account });
        }
      }
    }

    // Sub-issues added on GitHub under an imported issue come in on their own.
    for (const { parent, nodeIds, account } of discovered) {
      const found = yield* issueApi.issues({ host: parent.source!.host, nodeIds }).pipe(
        asAccount(account),
        Effect.orElseSucceed(() => []),
      );
      yield* importTree({ roots: found, parent, area: null, account, known, strict: false }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("roadmap sync could not import new sub-issues", {
            itemId: parent.id,
            error: error._tag,
          }),
        ),
      );
    }
  });

  const worker = yield* makeDrainableWorker((scope: "all" | "requested") =>
    Effect.suspend(() => {
      if (scope === "requested") requestedSweepQueued = false;
      return sweep(scope);
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("roadmap GitHub sync sweep failed", { cause: Cause.pretty(cause) }),
      ),
    ),
  );

  // Requested items wait for one queued sweep, so a burst of edits reads together.
  const requestSweep = Effect.suspend(() => {
    if (requestedSweepQueued) return Effect.void;
    requestedSweepQueued = true;
    return worker.enqueue("requested");
  });

  const requestSync: RoadmapGitHubSync["Service"]["requestSync"] = (itemId) =>
    Effect.suspend(() => {
      requested.add(itemId);
      return requestSweep;
    });

  const start: RoadmapGitHubSync["Service"]["start"] = Effect.fn("RoadmapGitHubSync.start")(
    function* () {
      // A user or agent change to a synced field stamps its local change time,
      // which is the cue to push it now rather than at the next sweep.
      const stamps = new Map<RoadmapItemId, string>();
      const stampOf = (item: RoadmapWorkItem) =>
        item.source === null ? null : stampText(item.source.localChangedAt);
      yield* forkParked(
        Stream.runForEach(roadmap.stream(), (change) => {
          if (change.type === "snapshot") {
            for (const item of change.items) {
              const stamp = stampOf(item);
              if (stamp !== null) stamps.set(item.id, stamp);
            }
            return Effect.void;
          }
          if (change.type !== "item.upserted") return Effect.void;
          const stamp = stampOf(change.item);
          if (stamp === null) return Effect.void;
          const previous = stamps.get(change.item.id);
          stamps.set(change.item.id, stamp);
          const fresh = stampText(ROADMAP_NO_LOCAL_CHANGES);
          return stamp !== (previous ?? fresh) ? requestSync(change.item.id) : Effect.void;
        }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("roadmap GitHub sync stopped watching edits", {
                cause: Cause.pretty(cause),
              }),
          ),
        ),
      );
      yield* forkParked(syncNow.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid));
    },
  );

  const syncNow: RoadmapGitHubSync["Service"]["syncNow"] = worker
    .enqueue("all")
    .pipe(Effect.andThen(worker.drain));

  return RoadmapGitHubSync.of({ importIssue, requestSync, syncNow, start, drain: worker.drain });
});

export const layer = Layer.effect(RoadmapGitHubSync, make);
