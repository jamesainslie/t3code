import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import type { DocumentCommentActions } from "./DocumentCommentsMargin";

/** Comment commands for one file in one thread, reported through the usual command toasts. */
export function useDocumentCommentActions(
  threadRef: ScopedThreadRef,
  filePath: string,
): DocumentCommentActions {
  const add = useAtomCommand(threadEnvironment.addDocumentComment);
  const update = useAtomCommand(threadEnvironment.updateDocumentComment);
  const remove = useAtomCommand(threadEnvironment.deleteDocumentComment);
  const resolve = useAtomCommand(threadEnvironment.resolveDocumentComment);
  const reopen = useAtomCommand(threadEnvironment.reopenDocumentComment);
  const { environmentId, threadId } = threadRef;

  return useMemo(
    () => ({
      add: ({ commentId, anchor, body }) =>
        void add({ environmentId, input: { threadId, commentId, filePath, anchor, body } }),
      update: (commentId, body) =>
        void update({ environmentId, input: { threadId, commentId, body } }),
      remove: (commentId) => void remove({ environmentId, input: { threadId, commentId } }),
      resolve: (commentId) =>
        void resolve({ environmentId, input: { threadId, commentId, resolution: null } }),
      reopen: (commentId) => void reopen({ environmentId, input: { threadId, commentId } }),
    }),
    [add, environmentId, filePath, remove, reopen, resolve, threadId, update],
  );
}
