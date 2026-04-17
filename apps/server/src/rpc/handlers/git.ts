// Git WS RPC handlers.

import { Effect, Queue, Stream } from "effect";
import {
  type GitActionProgressEvent,
  type GitManagerServiceError,
  WS_METHODS,
} from "@t3tools/contracts";

import { observeRpcEffect, observeRpcStream } from "../../observability/RpcInstrumentation.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import type { HandlerDeps } from "./shared.ts";

export function gitHandlers(deps: HandlerDeps) {
  const { git, gitManager, gitStatusBroadcaster, helpers } = deps;
  const { refreshGitStatus } = helpers;

  return {
    [WS_METHODS.subscribeGitStatus]: (input) =>
      observeRpcStream(WS_METHODS.subscribeGitStatus, gitStatusBroadcaster.streamStatus(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitRefreshStatus]: (input) =>
      observeRpcEffect(WS_METHODS.gitRefreshStatus, gitStatusBroadcaster.refreshStatus(input.cwd), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitPull]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitPull,
        git.pullCurrentBranch(input.cwd).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => Effect.failCause(cause),
            onSuccess: (result) =>
              refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
          }),
        ),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitRunStackedAction]: (input) =>
      observeRpcStream(
        WS_METHODS.gitRunStackedAction,
        Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
          gitManager
            .runStackedAction(input, {
              actionId: input.actionId,
              progressReporter: {
                publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
              },
            })
            .pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Queue.failCause(queue, cause),
                onSuccess: () =>
                  refreshGitStatus(input.cwd).pipe(
                    Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                  ),
              }),
            ),
        ),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitResolvePullRequest]: (input) =>
      observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitPreparePullRequestThread]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitPreparePullRequestThread,
        gitManager
          .preparePullRequestThread(input)
          .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitListBranches]: (input) =>
      observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitCreateWorktree]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitCreateWorktree,
        git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitRemoveWorktree]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitRemoveWorktree,
        git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitCreateBranch]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitCreateBranch,
        git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitCheckout]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitCheckout,
        Effect.scoped(git.checkoutBranch(input)).pipe(
          Effect.tap(() => refreshGitStatus(input.cwd)),
        ),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitInit]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitInit,
        git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        { "rpc.aggregate": "git" },
      ),
  } satisfies WsMethodRegistry;
}
