import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import * as SourceControlRateLimit from "@lathe/source-control-core/server/SourceControlRateLimit";

import * as GitHubAppSignIn from "./GitHubAppSignIn.ts";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubIssueApi from "./GitHubIssueApi.ts";
import * as GitHubQuota from "./GitHubQuota.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

interface SentQuery {
  readonly query: string;
  readonly variables: Record<string, unknown>;
  readonly authorization: string | undefined;
}

function harness(respond: (body: SentQuery) => unknown) {
  const sent: Array<SentQuery> = [];
  const services = Layer.mergeAll(
    Layer.succeed(GitHubCredentials.GitHubCredentials, {
      get: (host) =>
        Effect.succeed({
          host,
          token: Redacted.make("active"),
          source: "gh" as const,
          fingerprint: `${host}:active`,
        }),
      saved: () => Effect.succeedNone,
      fingerprint: (host, token) => Effect.succeed(`${host}:${token}`),
      invalidate: () => Effect.void,
    }),
    Layer.mock(GitHubAppSignIn.GitHubAppSignIn)({
      enabled: false,
      token: () => Effect.succeedNone,
      invalidate: () => Effect.void,
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
        Effect.sync(() => {
          const body = request.body;
          const parsed =
            body._tag === "Uint8Array"
              ? (JSON.parse(new TextDecoder().decode(body.body)) as {
                  query: string;
                  variables: Record<string, unknown>;
                })
              : { query: "", variables: {} };
          const query = { ...parsed, authorization: request.headers["authorization"] };
          sent.push(query);
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(respond(query)), {
              headers: { "content-type": "application/json" },
            }),
          );
        }),
      ),
    ),
    GitHubQuota.layer,
    SourceControlRateLimit.layer,
  );
  const layer = GitHubIssueApi.layer.pipe(
    Layer.provideMerge(GitHubRest.layer),
    Layer.provideMerge(services),
  );
  return { layer, sent };
}

const node = (id: string, overrides: Record<string, unknown> = {}) => ({
  __typename: "Issue",
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  title: `Issue ${id}`,
  state: "OPEN",
  updatedAt: "2026-10-18T08:00:00Z",
  url: `https://github.com/acme/web/issues/${id}`,
  viewerCanUpdate: true,
  repository: { name: "web", owner: { __typename: "Organization", login: "acme" } },
  parent: null,
  subIssues: { nodes: [] },
  blockedBy: { nodes: [] },
  ...overrides,
});

describe("GitHubIssueApi", () => {
  it.effect("reads an issue by number with its parent, sub-issues and blockers", () => {
    const { layer, sent } = harness(() => ({
      data: {
        repository: {
          issue: node("I_12", {
            number: 12,
            state: "CLOSED",
            viewerCanUpdate: false,
            parent: { id: "I_1" },
            subIssues: { nodes: [{ id: "I_13" }, null, { id: "I_14" }] },
            blockedBy: { nodes: [{ id: "I_9" }] },
          }),
        },
      },
    }));
    return Effect.gen(function* () {
      const api = yield* GitHubIssueApi.GitHubIssueApi;
      const issue = yield* api.issue({
        host: "github.com",
        owner: "acme",
        repo: "web",
        number: 12,
      });
      assert.deepStrictEqual(issue, {
        host: "github.com",
        owner: "acme",
        repo: "web",
        number: 12,
        nodeId: "I_12",
        url: "https://github.com/acme/web/issues/I_12",
        title: "Issue I_12",
        closed: true,
        updatedAt: "2026-10-18T08:00:00Z",
        writable: false,
        parentNodeId: "I_1",
        subIssueNodeIds: ["I_13", "I_14"],
        blockedByNodeIds: ["I_9"],
      });
      assert.deepStrictEqual(sent[0]!.variables, { owner: "acme", name: "web", number: 12 });
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails as not found when the repository has no such issue", () => {
    const { layer } = harness(() => ({ data: { repository: { issue: null } } }));
    return Effect.gen(function* () {
      const api = yield* GitHubIssueApi.GitHubIssueApi;
      const error = yield* Effect.flip(
        api.issue({ host: "github.com", owner: "acme", repo: "web", number: 404 }),
      );
      assert.strictEqual(error._tag, "GitHubApiNotFoundError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads issues by node id in batches of 50", () => {
    const { layer, sent } = harness((query) => ({
      data: { nodes: (query.variables["ids"] as Array<string>).map((id) => node(id)) },
    }));
    return Effect.gen(function* () {
      const api = yield* GitHubIssueApi.GitHubIssueApi;
      const nodeIds = Array.from({ length: 60 }, (_, index) => `I_${index + 1}`);
      const issues = yield* api.issues({ host: "github.com", nodeIds });
      assert.deepStrictEqual(
        issues.map((issue) => issue.nodeId),
        nodeIds,
      );
      assert.deepStrictEqual(
        sent.map((query) => (query.variables["ids"] as Array<string>).length),
        [50, 10],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("leaves out an issue GitHub no longer shows and keeps the rest of its batch", () => {
    const { layer, sent } = harness((query) => {
      const requested = query.variables["ids"] as Array<string>;
      return requested.includes("I_gone")
        ? {
            data: { nodes: requested.map((id) => (id === "I_gone" ? null : node(id))) },
            errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }],
          }
        : { data: { nodes: requested.map((id) => node(id)) } };
    });
    return Effect.gen(function* () {
      const api = yield* GitHubIssueApi.GitHubIssueApi;
      const issues = yield* api.issues({ host: "github.com", nodeIds: ["I_1", "I_gone", "I_2"] });
      assert.deepStrictEqual(
        issues.map((issue) => issue.nodeId),
        ["I_1", "I_2"],
      );
      // The failed batch, then one read per id.
      assert.strictEqual(sent.length, 4);
    }).pipe(Effect.provide(layer));
  });

  it.effect("sends each write with the right mutation and the pinned credential", () => {
    const payloads = [
      "updateIssue",
      "closeIssue",
      "reopenIssue",
      "addSubIssue",
      "removeSubIssue",
      "addBlockedBy",
      "removeBlockedBy",
    ];
    const { layer, sent } = harness(() => ({
      data: Object.fromEntries(payloads.map((field) => [field, { clientMutationId: null }])),
    }));
    const pinned = {
      host: "github.com",
      token: Redacted.make("work-token"),
      credentialFingerprint: "github.com:work:abc",
    };
    return Effect.gen(function* () {
      const api = yield* GitHubIssueApi.GitHubIssueApi;
      const host = "github.com";
      yield* api.setTitle({ host, issueId: "I_1", title: "Renamed" });
      yield* api.setClosed({ host, issueId: "I_1", closed: true });
      yield* api.setClosed({ host, issueId: "I_1", closed: false });
      yield* api.setParent({ host, issueId: "I_1", parentId: "I_2", previousParentId: null });
      yield* api.setParent({ host, issueId: "I_1", parentId: null, previousParentId: "I_2" });
      yield* api.setParent({ host, issueId: "I_1", parentId: null, previousParentId: null });
      yield* api.setBlockedBy({ host, issueId: "I_1", blockingIssueId: "I_3", blocked: true });
      yield* api.setBlockedBy({ host, issueId: "I_1", blockingIssueId: "I_3", blocked: false });
      expect(sent.map((query) => /^mutation (\w+)/.exec(query.query)?.[1])).toEqual([
        "RoadmapUpdateIssueTitle",
        "RoadmapCloseIssue",
        "RoadmapReopenIssue",
        "RoadmapAddSubIssue",
        "RoadmapRemoveSubIssue",
        "RoadmapAddBlockedBy",
        "RoadmapRemoveBlockedBy",
      ]);
      assert.deepStrictEqual(sent[3]!.variables, { issueId: "I_2", subIssueId: "I_1" });
      assert.deepStrictEqual(sent[4]!.variables, { issueId: "I_2", subIssueId: "I_1" });
      assert.deepStrictEqual(sent[5]!.variables, { issueId: "I_1", blockingIssueId: "I_3" });
      expect(sent.every((query) => query.authorization === "Bearer work-token")).toBe(true);
    }).pipe(
      Effect.provideService(GitHubRequestPolicy.PinnedGitHubCredential, pinned),
      Effect.provide(layer),
    );
  });
});
