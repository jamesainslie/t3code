import * as Schema from "effect/Schema";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

export class CopyTextClipboardWriteError extends Schema.TaggedError<CopyTextClipboardWriteError>()(
  "CopyTextClipboardWriteError",
  {
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to copy ${this.target} to the clipboard.`;
  }
}

export class CopyTextHapticFeedbackError extends Schema.TaggedError<CopyTextHapticFeedbackError>()(
  "CopyTextHapticFeedbackError",
  {
    target: Schema.String,
    feedback: Schema.Literals(["light-impact", "selection"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to trigger ${this.feedback} haptic feedback after copying ${this.target}.`;
  }
}

interface CopyTextWithHapticOptions {
  readonly target?: string;
  readonly feedback?: "light-impact" | "selection";
}

export async function tryCopyTextWithHaptic(
  value: string,
  options: CopyTextWithHapticOptions = {},
): Promise<boolean> {
  const target = options.target ?? "text";

  const clipboardWrite = (async () => {
    try {
      await Clipboard.setStringAsync(value);
      return true;
    } catch (cause) {
      const error = new CopyTextClipboardWriteError({ target, cause });
      console.error(error.message, { _tag: error._tag, target, stack: error.stack });
      return false;
    }
  })();

  playCopyHaptic(options);

  return await clipboardWrite;
}

/** The copy confirmation haptic, for copies that write the clipboard some other way. */
export function playCopyHaptic(options: CopyTextWithHapticOptions = {}): void {
  const target = options.target ?? "text";
  const feedback = options.feedback ?? "light-impact";
  void (async () => {
    try {
      if (feedback === "selection") {
        await Haptics.selectionAsync();
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (cause) {
      const error = new CopyTextHapticFeedbackError({ target, feedback, cause });
      console.error(error.message, { _tag: error._tag, target, feedback, stack: error.stack });
    }
  })();
}

export function copyTextWithHaptic(value: string, options: CopyTextWithHapticOptions = {}): void {
  void tryCopyTextWithHaptic(value, options);
}
