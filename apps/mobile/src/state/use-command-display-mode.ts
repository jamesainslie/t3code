import { useAtomValue } from "@effect/atom-react";
import type { CommandDisplayMode } from "@lathe/contracts";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "./preferences";

/** Fork: whether this device shows command output open in the thread feed. */
export function useCommandDisplayMode(): CommandDisplayMode {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? (preferences.value.commandDisplayMode ?? "collapsed")
    : "collapsed";
}
