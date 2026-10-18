import type {
  EnvironmentId,
  PullRequestLinkedThreadsResult,
  ScopedThreadRef,
} from "@lathe/contracts";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

const COMMAND_PALETTE_OPEN_EVENT = "lathe:open-command-palette";

export interface CommandPaletteOpenDetail {
  // Fork: roadmap. "roadmap-attach" opens the work item picker for `roadmapThreadRef`.
  readonly open?: "add-project" | "new-thread-in" | "depends-on" | "roadmap-attach";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
  /** The waiting thread the "Depends on" picker parks. Required for that mode. */
  readonly blockedThreadRef?: ScopedThreadRef;
  /** Fork: roadmap. The thread the work item picker attaches. Required for that mode. */
  readonly roadmapThreadRef?: ScopedThreadRef;
  /** Fork: roadmap. With "new-thread-in", told the thread the chosen project starts. */
  readonly onThreadCreated?: (thread: ScopedThreadRef) => void;
}

/** Open the palette on the "Depends on" picker for a thread that should wait. */
export function openThreadDependencyPicker(blockedThreadRef: ScopedThreadRef): void {
  openCommandPalette({ open: "depends-on", blockedThreadRef });
}

/** Fork: roadmap. Open the palette on the work item picker for a thread. */
export function openRoadmapAttachPicker(roadmapThreadRef: ScopedThreadRef): void {
  openCommandPalette({ open: "roadmap-attach", roadmapThreadRef });
}

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
}

export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
