import { memo, useCallback, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import MermaidDom from "./MermaidDom";

export const MermaidDiagram = memo(function MermaidDiagram({
  source,
  pending,
  onRepair,
}: {
  source: string;
  pending: boolean;
  onRepair?: ((prompt: string) => void) | undefined;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const repair = useCallback(
    async (prompt: string) => {
      setExpanded(false);
      onRepair?.(prompt);
    },
    [onRepair],
  );
  const content = (fullScreen: boolean) => (
    <>
      <View className="flex-row items-center gap-2 border-b border-border px-3 py-2">
        <Text className="flex-1 text-xs text-foreground-muted">Mermaid</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showSource ? "View diagram" : "View source"}
          onPress={() => setShowSource(!showSource)}
          className="min-h-11 justify-center px-2"
        >
          <Text className="text-xs">{showSource ? "Diagram" : "Source"}</Text>
        </Pressable>
        <CopyTextButton
          text={source}
          accessibilityLabel="Copy source"
          buttonSize={44}
          iconSize={16}
          tintColor={themeAppearance === "dark" ? "#e4e4e7" : "#27272a"}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fullScreen ? "Close diagram" : "Expand diagram"}
          onPress={() => setExpanded(!fullScreen)}
          className="min-h-11 justify-center px-2"
        >
          <Text className="text-xs">{fullScreen ? "Close" : "Expand"}</Text>
        </Pressable>
      </View>
      {pending ? (
        <View className="min-h-32 items-center justify-center p-6">
          <Text className="text-xs text-foreground-muted">Waiting for diagram…</Text>
        </View>
      ) : (
        <MermaidDom
          source={source}
          theme={themeAppearance}
          expanded={fullScreen}
          showSource={showSource}
          canRepair={Boolean(onRepair)}
          onRepair={repair}
          dom={{
            useExpoDOMWebView: false,
            scrollEnabled: false,
            style: {
              flex: fullScreen ? 1 : undefined,
              height: fullScreen ? undefined : 320,
              backgroundColor: "transparent",
            },
          }}
        />
      )}
    </>
  );
  return (
    <View className="my-3 overflow-hidden rounded-xl border border-border bg-card">
      {expanded ? (
        <View className="h-96 items-center justify-center">
          <Text className="text-xs text-foreground-muted">Diagram open</Text>
        </View>
      ) : (
        content(false)
      )}
      <Modal
        visible={expanded}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setExpanded(false)}
      >
        <SafeAreaView className="flex-1 bg-card">{expanded ? content(true) : null}</SafeAreaView>
      </Modal>
    </View>
  );
});
