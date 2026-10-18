/**
 * Fork: roadmap. The GitHub issue reads and writes the roadmap's GitHub sync makes. Every call
 * runs under whatever credential the caller pinned (`GitHubRequestPolicy.PinnedGitHubCredential`),
 * so the sync reads each repository with the account its owner routes to.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { GraphQLClient, GraphQLClientError } from "effect/graphql";

import * as GitHubGraphQlClient from "./gitHubGraphQlClient.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import { type RoadmapIssueFields, RoadmapIssuesGraphQLGroup } from "./roadmapIssues.graphql.ts";

/** GitHub accepts up to 100 ids per `nodes` read; each issue also carries two id lists. */
const NODE_BATCH = 50;

export interface GitHubIssue {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly nodeId: string;
  readonly url: string;
  readonly title: string;
  readonly closed: boolean;
  /** As GitHub wrote it; compare by parsing, never as text. */
  readonly updatedAt: string;
  /** Whether the reading account may edit the issue. */
  readonly writable: boolean;
  readonly parentNodeId: string | null;
  readonly subIssueNodeIds: ReadonlyArray<string>;
  readonly blockedByNodeIds: ReadonlyArray<string>;
}

export class GitHubIssueReadError extends Schema.TaggedError<GitHubIssueReadError>()(
  "GitHubIssueReadError",
  {
    host: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `GitHub returned an unreadable ${this.operation} response.`;
  }
}

export type GitHubIssueApiError = GitHubRequestPolicy.GitHubApiError | GitHubIssueReadError;

export class GitHubIssueApi extends Context.Service<
  GitHubIssueApi,
  {
    /** Fails with `GitHubApiNotFoundError` when the issue is missing or the account cannot see it. */
    readonly issue: (input: {
      readonly host: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    }) => Effect.Effect<GitHubIssue, GitHubIssueApiError>;
    /**
     * The issues with these node ids. One GitHub no longer shows (deleted, transferred, or
     * hidden from the account) is left out rather than failing the rest.
     */
    readonly issues: (input: {
      readonly host: string;
      readonly nodeIds: ReadonlyArray<string>;
    }) => Effect.Effect<ReadonlyArray<GitHubIssue>, GitHubIssueApiError>;
    readonly setTitle: (input: {
      readonly host: string;
      readonly issueId: string;
      readonly title: string;
    }) => Effect.Effect<void, GitHubIssueApiError>;
    readonly setClosed: (input: {
      readonly host: string;
      readonly issueId: string;
      readonly closed: boolean;
    }) => Effect.Effect<void, GitHubIssueApiError>;
    /** Null takes the issue out of `previousParentId`; an id makes it that issue's sub-issue. */
    readonly setParent: (input: {
      readonly host: string;
      readonly issueId: string;
      readonly parentId: string | null;
      readonly previousParentId: string | null;
    }) => Effect.Effect<void, GitHubIssueApiError>;
    readonly setBlockedBy: (input: {
      readonly host: string;
      readonly issueId: string;
      readonly blockingIssueId: string;
      readonly blocked: boolean;
    }) => Effect.Effect<void, GitHubIssueApiError>;
  }
>()("@lathe/source-control-github/server/GitHubIssueApi") {}

const ids = (connection: RoadmapIssueFields["subIssues"]) =>
  (connection.nodes ?? []).flatMap((node) => (node === null ? [] : [node.id]));

const toIssue = (host: string, fields: RoadmapIssueFields): GitHubIssue => ({
  host,
  owner: fields.repository.owner.login,
  repo: fields.repository.name,
  number: fields.number,
  nodeId: fields.id,
  url: fields.url,
  title: fields.title,
  closed: fields.state === "CLOSED",
  updatedAt: fields.updatedAt,
  writable: fields.viewerCanUpdate,
  parentNodeId: fields.parent?.id ?? null,
  subIssueNodeIds: ids(fields.subIssues),
  blockedByNodeIds: ids(fields.blockedBy),
});

const chunks = <A>(values: ReadonlyArray<A>, size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );

const make = Effect.gen(function* () {
  const client = yield* GraphQLClient.make(
    RoadmapIssuesGraphQLGroup.middleware(GitHubGraphQlClient.GitHubGraphQlAuth),
  ).pipe(Effect.provide(GitHubGraphQlClient.layer));

  /** One generated call against `host`; an answer that does not decode is a read error. */
  const graphql =
    (host: string, operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        GitHubGraphQlClient.call({ host, operation }),
        Effect.mapError((error) =>
          GraphQLClientError.isGraphQLClientError(error)
            ? new GitHubIssueReadError({ host, operation, cause: error })
            : (error as Exclude<typeof error, GraphQLClientError.GraphQLClientError>),
        ),
      );

  const issue: GitHubIssueApi["Service"]["issue"] = (input) =>
    client
      .RoadmapIssueByNumber({ owner: input.owner, name: input.repo, number: input.number })
      .pipe(
        graphql(input.host, "roadmapIssue"),
        Effect.flatMap((result) => {
          const found = result.repository?.issue ?? null;
          return found === null
            ? Effect.fail(
                new GitHubRequestPolicy.GitHubApiNotFoundError({
                  host: GitHubRequestPolicy.normalizeHost(input.host),
                  operation: "roadmapIssue",
                }),
              )
            : Effect.succeed(toIssue(input.host, found));
        }),
      );

  const readBatch = (host: string, nodeIds: ReadonlyArray<string>) =>
    client.RoadmapIssueTree({ ids: nodeIds }).pipe(
      graphql(host, "roadmapIssues"),
      Effect.map((result) =>
        result.nodes.flatMap((node) =>
          node !== null && node.__typename === "Issue"
            ? [toIssue(host, node as RoadmapIssueFields)]
            : [],
        ),
      ),
    );

  const issues: GitHubIssueApi["Service"]["issues"] = (input) =>
    Effect.forEach(chunks(input.nodeIds, NODE_BATCH), (batch) =>
      readBatch(input.host, batch).pipe(
        // GitHub fails a whole `nodes` read over one missing id, so read that batch one by one
        // to keep the issues it can still see.
        Effect.catchTags({
          GitHubApiNotFoundError: () =>
            Effect.forEach(batch, (nodeId) =>
              readBatch(input.host, [nodeId]).pipe(
                Effect.catchTags({ GitHubApiNotFoundError: () => Effect.succeed([]) }),
              ),
            ).pipe(Effect.map((found) => found.flat())),
        }),
      ),
    ).pipe(Effect.map((found) => found.flat()));

  const setTitle: GitHubIssueApi["Service"]["setTitle"] = (input) =>
    client
      .RoadmapUpdateIssueTitle({ issueId: input.issueId, title: input.title })
      .pipe(graphql(input.host, "roadmapSetIssueTitle"), Effect.asVoid);

  const setClosed: GitHubIssueApi["Service"]["setClosed"] = (input) =>
    input.closed
      ? client
          .RoadmapCloseIssue({ issueId: input.issueId })
          .pipe(graphql(input.host, "roadmapCloseIssue"), Effect.asVoid)
      : client
          .RoadmapReopenIssue({ issueId: input.issueId })
          .pipe(graphql(input.host, "roadmapReopenIssue"), Effect.asVoid);

  const setParent: GitHubIssueApi["Service"]["setParent"] = (input) =>
    input.parentId !== null
      ? client
          .RoadmapAddSubIssue({ issueId: input.parentId, subIssueId: input.issueId })
          .pipe(graphql(input.host, "roadmapAddSubIssue"), Effect.asVoid)
      : input.previousParentId === null
        ? Effect.void
        : client
            .RoadmapRemoveSubIssue({ issueId: input.previousParentId, subIssueId: input.issueId })
            .pipe(graphql(input.host, "roadmapRemoveSubIssue"), Effect.asVoid);

  const setBlockedBy: GitHubIssueApi["Service"]["setBlockedBy"] = (input) => {
    const variables = { issueId: input.issueId, blockingIssueId: input.blockingIssueId };
    return input.blocked
      ? client
          .RoadmapAddBlockedBy(variables)
          .pipe(graphql(input.host, "roadmapAddBlockedBy"), Effect.asVoid)
      : client
          .RoadmapRemoveBlockedBy(variables)
          .pipe(graphql(input.host, "roadmapRemoveBlockedBy"), Effect.asVoid);
  };

  return GitHubIssueApi.of({ issue, issues, setTitle, setClosed, setParent, setBlockedBy });
});

/** Needs `GitHubRequestPolicy` and an HTTP client, as the pull request API does. */
export const layer = Layer.effect(GitHubIssueApi, make);
