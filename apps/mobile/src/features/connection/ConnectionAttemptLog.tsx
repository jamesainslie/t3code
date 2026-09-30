import { useAtomValue } from "@effect/atom-react";
import {
  attemptLogToText,
  describeAttemptLogEntry,
  type AttemptLogTone,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { environmentCatalog } from "../../connection/catalog";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";

const TONE_TEXT: Record<AttemptLogTone, string> = {
  muted: "text-foreground-muted",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
};

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Every recent connection attempt for an environment and why it failed. Mount it only while
 * shown; it follows the attempt log for as long as it is mounted.
 */
export function ConnectionAttemptLog(props: { readonly environmentId: EnvironmentId }) {
  const attempts = Option.getOrElse(
    AsyncResult.value(useAtomValue(environmentCatalog.attemptLogAtom(props.environmentId))),
    () => [],
  );
  return (
    <View className="w-full gap-2">
      <ScrollView className="max-h-48 w-full rounded-lg bg-subtle px-3 py-2">
        {attempts.length === 0 ? (
          <Text className="font-mono text-xs text-foreground-muted">No attempts yet.</Text>
        ) : (
          attempts.map((entry) => {
            const { text, tone } = describeAttemptLogEntry(entry);
            return (
              <Text
                key={`${entry.at}:${entry.attempt}:${entry.kind}:${entry.kind === "stage" ? entry.stage : ""}`}
                selectable
                className={`font-mono text-xs leading-snug ${TONE_TEXT[tone]}`}
              >
                {TIME.format(entry.at)} {text}
              </Text>
            );
          })
        )}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        className="self-center rounded-full px-3 py-1.5 active:opacity-70"
        onPress={() =>
          copyTextWithHaptic(attemptLogToText(attempts), { target: "connection-details" })
        }
      >
        <Text className="text-xs font-t3-bold text-foreground-muted">Copy details</Text>
      </Pressable>
    </View>
  );
}
