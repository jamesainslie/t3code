import {
  parseTerminalText,
  TERMINAL_PALETTE,
  terminalColorHex,
  terminalTranscript,
} from "@t3tools/client-runtime/work-log/terminal";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";

const TerminalOutput = memo(function TerminalOutput(props: {
  readonly text: string;
  readonly themeAppearance: "light" | "dark";
}) {
  const segments = useMemo(() => parseTerminalText(props.text), [props.text]);
  const palette = TERMINAL_PALETTE[props.themeAppearance];
  return (
    <Text selectable className="font-mono text-2xs leading-normal text-foreground">
      {segments.map((segment, index) => {
        const { fg, bg, bold, dim, italic, underline } = segment.style;
        return (
          <Text
            // Segments never reorder for a given output, so their index is a stable key.
            key={index}
            style={{
              color: fg === undefined ? undefined : terminalColorHex(fg, palette),
              backgroundColor: bg === undefined ? undefined : terminalColorHex(bg, palette),
              fontWeight: bold ? "600" : undefined,
              opacity: dim ? 0.6 : undefined,
              fontStyle: italic ? "italic" : undefined,
              textDecorationLine: underline ? "underline" : undefined,
            }}
          >
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
});

/**
 * Fork: a command drawn as a terminal (ported from horde), matching the web
 * TerminalCard: the command, its ANSI-colored output, the exit code, and a
 * copy button for the plain transcript.
 */
export const ThreadTerminalCard = memo(function ThreadTerminalCard(props: {
  readonly command: string;
  readonly exitCode: number | undefined;
  /** The command's output, once known. */
  readonly output: string | null;
  /** Shown in place of output while it loads or when it is unavailable. */
  readonly status: string | null;
  readonly themeAppearance: "light" | "dark";
  readonly onCopy: (transcript: string) => void;
}) {
  const failed = props.exitCode !== undefined && props.exitCode !== 0;
  const pending = props.output === null && props.status === "Loading output…";
  return (
    <View
      className={
        failed
          ? "overflow-hidden rounded-lg border border-danger/40 bg-card"
          : "overflow-hidden rounded-lg border border-border-subtle bg-card"
      }
    >
      <View className="flex-row items-center gap-2 border-b border-border-subtle py-1 pl-2.5 pr-1">
        <View
          className="flex-row gap-1 opacity-60"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View className="h-2 w-2 rounded-full bg-danger" />
          <View className="h-2 w-2 rounded-full bg-warning" />
          <View className="h-2 w-2 rounded-full bg-emerald-400" />
        </View>
        <Text className="text-3xs uppercase tracking-wider text-foreground-subtle">terminal</Text>
        <View className="flex-1" />
        {props.exitCode !== undefined ? (
          <Text
            className={
              failed ? "text-3xs text-danger-foreground" : "text-3xs text-foreground-subtle"
            }
          >
            exit {props.exitCode}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy command and output"
          disabled={pending}
          hitSlop={8}
          className="h-6 w-6 items-center justify-center rounded-md active:opacity-60"
          onPress={() =>
            props.onCopy(
              terminalTranscript({
                command: props.command,
                output: props.output,
                exitCode: props.exitCode,
              }),
            )
          }
        >
          <SymbolView
            name="doc.on.doc"
            size={12}
            tintColorClassName="accent-foreground-subtle"
            type="monochrome"
          />
        </Pressable>
      </View>
      <ScrollView
        nestedScrollEnabled
        directionalLockEnabled
        showsVerticalScrollIndicator
        className="max-h-60"
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
      >
        <View className="flex-row gap-1.5">
          <Text className="font-mono text-2xs leading-normal text-adaptive-emerald-600-400">$</Text>
          <Text
            selectable
            className="min-w-0 flex-1 font-mono text-2xs leading-normal text-foreground"
          >
            {props.command.trim()}
          </Text>
        </View>
        {props.output ? (
          <View className="mt-1.5">
            <TerminalOutput text={props.output} themeAppearance={props.themeAppearance} />
          </View>
        ) : props.status ? (
          <Text className="mt-1.5 font-mono text-2xs italic leading-normal text-foreground-muted">
            {props.status}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
});
