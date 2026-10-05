import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Fork: comments a user leaves on documents a thread produced. They live beside the thread,
 * not in it, so a thread stream never carries them; viewers subscribe per thread.
 */
export function createDocumentCommentEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** The thread's comments, sent whole on subscribe and again after every change. */
    comments: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:document-comments",
      tag: WS_METHODS.subscribeThreadDocumentComments,
    }),
    mutate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:document-comments:mutate",
      tag: WS_METHODS.threadDocumentCommentsMutate,
    }),
  };
}
