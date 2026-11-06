import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@lathe/contracts";
import {
  decodeComposerContextFragment,
  encodeComposerContextFragment,
} from "@lathe/shared/composerContextClipboard";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  threadContextRecord,
} from "@lathe/shared/composerContextReferences";
import { LATHE_COPIES_HOSTED_THREAD_LINKS } from "@lathe/shared/forkThreadLinks";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadReferenceCopyTarget } from "./threadReference.ts";

const thread = {
  threadRef: { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("thread-1") },
  title: "Fix the login flow",
};

const crossRepositoryPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "other/repo",
  number: 42,
  url: "https://github.com/other/repo/pull/42",
  source: "manual",
  linkedAt: "2026-01-01T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

describe("resolveThreadReferenceCopyTarget", () => {
  it("does not copy another reference while the open panel URL is unavailable", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        openPanelPullRequestUrl: null,
        pullRequests: [crossRepositoryPullRequest],
        linkedPullRequestUrl: "https://github.com/lathe/pr/12",
      }),
    ).toBeNull();
  });

  it("prefers the open panel pull request over the thread pull request", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        openPanelPullRequestUrl: "https://github.com/lathe/pr/14",
        pullRequests: [crossRepositoryPullRequest],
        linkedPullRequestUrl: "https://github.com/lathe/pr/12",
      }),
    ).toMatchObject({
      kind: "pull-request",
      value: "https://github.com/lathe/pr/14",
      successTitle: "PR link copied",
    });
  });

  it.each([null, "https://github.com/lathe/pr/12"])(
    "copies a native cross-repository link before the fallback URL %s",
    (linkedPullRequestUrl) => {
      expect(
        resolveThreadReferenceCopyTarget({
          ...thread,
          pullRequests: [crossRepositoryPullRequest],
          linkedPullRequestUrl,
        }),
      ).toMatchObject({
        kind: "pull-request",
        value: crossRepositoryPullRequest.url,
      });
    },
  );

  it("uses the fallback URL when native links are dismissed", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        pullRequests: [{ ...crossRepositoryPullRequest, source: "stack-dismissed" }],
        linkedPullRequestUrl: "https://github.com/lathe/pr/12",
      }),
    ).toMatchObject({ kind: "pull-request", value: "https://github.com/lathe/pr/12" });
  });

  it("copies a thread chip that pastes back as the same thread on its machine", () => {
    const target = resolveThreadReferenceCopyTarget({ ...thread, linkedPullRequestUrl: null });

    expect(target).toMatchObject({
      kind: "thread",
      description: "Fix the login flow",
      successTitle: "Thread copied",
    });
    const pasted = decodeComposerContextFragment(encodeComposerContextFragment(target!.fragment!));
    expect(pasted).toEqual({
      version: 1,
      source: { environmentId: "env-1" },
      records: [
        expect.objectContaining({
          kind: "thread",
          environmentId: "env-1",
          threadId: "thread-1",
          title: "Fix the login flow",
        }),
      ],
    });
    // Fork: the plain text is Lathe's own chip reference, never an app.t3.codes link (#71).
    expect(target!.value).toBe(
      `[Fix the login flow](lathe-context://v1/thread/${pasted!.records[0]!.contextId})`,
    );
    expect(collectComposerContextReferences(target!.value)).toEqual([
      expect.objectContaining({ kind: "thread", contextId: pasted!.records[0]!.contextId }),
    ]);
  });

  it("links through the build's hosted app", () => {
    expect(
      resolveThreadReferenceCopyTarget({ ...thread, hostedAppUrl: "https://preview.t3.codes" })
        ?.value,
    ).toBe(
      LATHE_COPIES_HOSTED_THREAD_LINKS
        ? "https://preview.t3.codes/threads/env-1/thread-1"
        : formatComposerContextReference(threadContextRecord(thread.threadRef, thread.title)),
    );
  });
});
