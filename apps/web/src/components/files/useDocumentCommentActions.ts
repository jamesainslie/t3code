import type { ScopedThreadRef, ThreadDocumentCommentMutation } from "@t3tools/contracts";
import { useMemo } from "react";

import { documentCommentsEnvironment } from "~/state/documentComments";
import { useAtomCommand } from "~/state/use-atom-command";

import type { DocumentCommentActions } from "./DocumentCommentsMargin";

/** Comment commands for one file in one thread, reported through the usual command toasts. */
export function useDocumentCommentActions(
  threadRef: ScopedThreadRef,
  filePath: string,
): DocumentCommentActions {
  const mutate = useAtomCommand(documentCommentsEnvironment.mutate);
  const { environmentId, threadId } = threadRef;

  return useMemo(() => {
    const send = (mutation: ThreadDocumentCommentMutation) =>
      void mutate({ environmentId, input: { threadId, mutation } });
    return {
      add: ({ commentId, anchor, body }) =>
        send({ type: "add", commentId, filePath, anchor, body }),
      update: (commentId, body) => send({ type: "update", commentId, body }),
      remove: (commentId) => send({ type: "delete", commentId }),
      resolve: (commentId) => send({ type: "resolve", commentId, resolution: null }),
      reopen: (commentId) => send({ type: "reopen", commentId }),
    };
  }, [environmentId, filePath, mutate, threadId]);
}
