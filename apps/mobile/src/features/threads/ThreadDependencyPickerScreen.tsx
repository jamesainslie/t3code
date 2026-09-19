import type { StaticScreenProps } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import { isDependencyCandidate } from "@t3tools/client-runtime/state/thread-settled";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { MaterialListRow } from "../../components/MaterialListRow";
import { MaterialScreenContent } from "../../components/MaterialScreenContent";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useProjects, useThreadShells } from "../../state/entities";
import { useThreadListActions } from "../home/useThreadListActions";

const SCREEN_TITLE = "Depends on";

type ThreadDependencyPickerRouteParams = {
  readonly environmentId: string;
  readonly threadId: string;
};

/**
 * Picks the thread a blocked thread waits on. Candidates come from the same
 * environment across projects, with the project as the subtitle, following the
 * new-task context pickers. Selecting one dispatches the link and returns.
 */
export function ThreadDependencyPickerRouteScreen({
  route,
}: StaticScreenProps<ThreadDependencyPickerRouteParams>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const threads = useThreadShells();
  const projects = useProjects();
  const { addThreadDependency } = useThreadListActions();

  const environmentId = EnvironmentId.make(route.params.environmentId);
  const threadId = ThreadId.make(route.params.threadId);
  const blocked = threads.find(
    (thread) => thread.environmentId === environmentId && thread.id === threadId,
  );

  const environmentThreads = useMemo(
    () => threads.filter((thread) => thread.environmentId === environmentId),
    [environmentId, threads],
  );
  const candidates = useMemo(
    () =>
      blocked === undefined
        ? []
        : environmentThreads.filter((candidate) =>
            isDependencyCandidate(environmentThreads, blocked, candidate),
          ),
    [blocked, environmentThreads],
  );
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );

  const handleSelect = useCallback(
    (dependsOnThreadId: ThreadId) => {
      if (blocked === undefined) return;
      void Haptics.selectionAsync();
      navigation.goBack();
      void addThreadDependency(blocked, dependsOnThreadId);
    },
    [addThreadDependency, blocked, navigation],
  );

  const rows = candidates.map((candidate, index) => {
    const project = projectByKey.get(`${candidate.environmentId}:${candidate.projectId}`) ?? null;
    const subtitle = project?.title ?? "";
    const favicon = project ? (
      <ProjectFavicon
        environmentId={candidate.environmentId}
        faviconPath={project.faviconPath}
        size={Platform.OS === "android" ? 24 : 17}
        projectTitle={project.title}
        workspaceRoot={project.workspaceRoot}
      />
    ) : null;

    if (Platform.OS === "android") {
      return (
        <MaterialListRow
          key={candidate.id}
          title={candidate.title}
          subtitle={subtitle}
          leading={favicon}
          accessibilityRole="button"
          onPress={() => handleSelect(candidate.id)}
        />
      );
    }
    return (
      <Pressable
        accessibilityLabel={[candidate.title, subtitle].filter(Boolean).join(", ")}
        accessibilityRole="button"
        className={cn(
          "min-h-14 flex-row items-center gap-3 bg-card px-4 py-3 active:bg-subtle",
          index !== candidates.length - 1 && "border-b border-border-subtle",
        )}
        key={candidate.id}
        onPress={() => handleSelect(candidate.id)}
      >
        {favicon}
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
            {candidate.title}
          </Text>
          {subtitle ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  });

  return (
    <View className="flex-1 bg-sheet" collapsable={false}>
      <NativeStackScreenOptions
        options={{ headerShown: Platform.OS !== "android", title: SCREEN_TITLE }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={SCREEN_TITLE}
          hideBottomBorder
          onBack={() => navigation.goBack()}
        />
      ) : null}
      <MaterialScreenContent>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 16) + 16,
            paddingHorizontal: 16,
            paddingTop: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {rows.length === 0 ? (
            <View className="items-center px-6 py-10">
              <Text className="text-center text-sm text-foreground-muted">
                {blocked === undefined
                  ? "This thread is no longer available."
                  : "No other thread in this environment can be waited on."}
              </Text>
            </View>
          ) : (
            <View
              className={
                Platform.OS === "android"
                  ? "overflow-hidden rounded-[28px] bg-card"
                  : "overflow-hidden rounded-2xl bg-card"
              }
            >
              {rows}
            </View>
          )}
        </ScrollView>
      </MaterialScreenContent>
    </View>
  );
}
