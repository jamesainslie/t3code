import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { executeProjectSync } from "@t3tools/client-runtime/state/project-sync";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { runtime } from "../../lib/runtime";
import { usePreparedConnection } from "../../state/session";

export function SyncedConversation({
  environmentId,
  threadId,
  bottomInset,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  bottomInset: number;
}) {
  const prepared = usePreparedConnection(environmentId);
  const navigation =
    useNavigation<NavigationProp<{ Thread: { environmentId: string; threadId: string } }>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continueInFork = async () => {
    if (Option.isNone(prepared) || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await runtime.runPromise(
        executeProjectSync(prepared.value, { operation: "continue", threadId }),
      );
      if (response.threadId)
        navigation.navigate("Thread", {
          environmentId: String(environmentId),
          threadId: String(response.threadId),
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <View className="gap-3 bg-screen px-4 pt-4" style={{ paddingBottom: bottomInset + 12 }}>
      <Text className="text-base font-semibold text-foreground">From T3 Code</Text>
      <Text className="text-sm text-foreground-muted">
        This conversation is synced from your main install. Continue in fork to work independently
        with its history.
      </Text>
      {error !== null ? (
        <Text accessibilityRole="alert" className="text-sm text-foreground">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending || Option.isNone(prepared)}
        onPress={() => void continueInFork()}
        className="min-h-12 items-center justify-center rounded-xl border border-border px-4 py-3"
      >
        <Text className="font-semibold text-foreground">
          {pending ? "Working…" : "Continue in fork"}
        </Text>
      </Pressable>
    </View>
  );
}
