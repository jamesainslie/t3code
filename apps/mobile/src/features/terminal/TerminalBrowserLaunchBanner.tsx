import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  terminalBrowserLaunchRelayMode,
  type TerminalBrowserLaunch,
} from "@t3tools/client-runtime/state/terminal";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";

interface TerminalBrowserLaunchBannerProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly launch: TerminalBrowserLaunch;
  readonly colors: {
    readonly background: string;
    readonly foreground: string;
    readonly border: string;
  };
}

function BannerButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly borderColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        borderColor: props.borderColor,
        borderRadius: 8,
        borderWidth: 1,
        opacity: props.disabled ? 0.5 : pressed ? 0.7 : 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
      })}
    >
      <Text className="text-xs font-medium">{props.label}</Text>
    </Pressable>
  );
}

/**
 * The phone's browser can never reach the environment's loopback listener, nor
 * host one of its own, so the pasted return URL is the only way a terminal
 * sign-in finishes here. A sign-in that posts its result has nothing to paste;
 * it needs the desktop app or a device code instead.
 */
export function TerminalBrowserLaunchBanner({
  environmentId,
  threadId,
  terminalId,
  launch,
  colors,
}: TerminalBrowserLaunchBannerProps) {
  const commandOptions = { reportFailure: false, reportDefect: false };
  const complete = useAtomCommand(terminalEnvironment.completeBrowserLaunch, commandOptions);
  const cancel = useAtomCommand(terminalEnvironment.cancelBrowserLaunch, commandOptions);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mobile never stands in for the loopback listener, so hosting is never on.
  const relayMode = terminalBrowserLaunchRelayMode({
    responseMode: launch.responseMode,
    redirectUri: launch.redirectUri,
    hosted: null,
  });
  const target = {
    environmentId,
    input: { threadId, terminalId, captureId: launch.captureId },
  };

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Success") return true;
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Could not finish sign-in.");
      }
      return false;
    } catch {
      setError("Could not finish sign-in. Try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <View
      accessibilityRole="summary"
      style={{
        backgroundColor: colors.background,
        borderBottomColor: colors.border,
        borderBottomWidth: 1,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text className="text-xs font-medium" style={{ color: colors.foreground }}>
        A command in this terminal wants to open a page in your browser.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <BannerButton
          label="Open"
          borderColor={colors.border}
          onPress={() => {
            void tryOpenExternalUrl(launch.url, "terminal-browser-launch").then((opened) => {
              if (!opened) setError("Could not open the page. Copy the link instead.");
            });
          }}
        />
        <BannerButton
          label="Copy link"
          borderColor={colors.border}
          onPress={() => copyTextWithHaptic(launch.url)}
        />
        <BannerButton
          label="Dismiss"
          borderColor={colors.border}
          disabled={pending}
          onPress={() => void run(() => cancel(target))}
        />
      </View>
      {relayMode === "unreachable" ? (
        <Text className="text-xs" style={{ color: colors.foreground, opacity: 0.8 }}>
          This sign-in posts its result to a page only this computer&apos;s T3 Code desktop app can
          catch. Open the link from the desktop app, or use the command&apos;s device-code option if
          it has one.
        </Text>
      ) : (
        <>
          <Text className="text-xs" style={{ color: colors.foreground, opacity: 0.8 }}>
            If it ends on a 127.0.0.1 or localhost page that will not load, paste that page&apos;s
            full address here.
          </Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput
              accessibilityLabel="Sign-in return URL"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-10 flex-1 rounded-xl py-2 text-sm"
              editable={!pending}
              keyboardType="url"
              maxLength={16_384}
              onChangeText={setCallbackUrl}
              placeholder="http://127.0.0.1:..."
              value={callbackUrl}
            />
            <BannerButton
              label="Continue"
              borderColor={colors.border}
              disabled={pending || callbackUrl.trim().length === 0}
              onPress={() => {
                const trimmed = callbackUrl.trim();
                if (!trimmed) return;
                void run(() =>
                  complete({ ...target, input: { ...target.input, callbackUrl: trimmed } }),
                ).then((accepted) => {
                  if (accepted) setCallbackUrl("");
                });
              }}
            />
          </View>
        </>
      )}
      {error ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
