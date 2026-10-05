import type { ScopedThreadRef, ThreadDocumentComment } from "@t3tools/contracts";
import { createDocumentCommentEnvironmentAtoms } from "@t3tools/client-runtime/state/document-comments";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const documentCommentsEnvironment =
  createDocumentCommentEnvironmentAtoms(connectionAtomRuntime);

/** A thread's document comments, or null while loading, unsupported, or when `ref` is null. */
export function useThreadDocumentComments(
  ref: ScopedThreadRef | null,
): ReadonlyArray<ThreadDocumentComment> | null {
  const query = useEnvironmentQuery(
    ref === null
      ? null
      : documentCommentsEnvironment.comments({
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId },
        }),
  );
  return query.data?.comments ?? null;
}
