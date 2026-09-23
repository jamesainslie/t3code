import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "~/terminal-links";

export function FileMarkdownPreview(props: {
  readonly sourceRef?: ((element: HTMLDivElement | null) => void) | undefined;
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: ScopedThreadRef;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const lastSeparator = Math.max(
    props.relativePath.lastIndexOf("/"),
    props.relativePath.lastIndexOf("\\"),
  );
  const imageBaseDir =
    lastSeparator >= 0
      ? resolvePathLinkTarget(props.relativePath.slice(0, lastSeparator), props.cwd)
      : props.cwd;

  // The citation source attributes let a selection here become a document quote.
  return (
    <div
      ref={props.sourceRef}
      data-document-citation-source={props.relativePath}
      data-document-citation-environment={props.threadRef.environmentId}
      data-document-citation-thread={props.threadRef.threadId}
    >
      <ChatMarkdown
        text={props.text}
        cwd={props.cwd}
        imageBaseDir={imageBaseDir}
        threadRef={props.threadRef}
        asDocument
        className="chat-markdown-document mx-auto max-w-4xl px-8 py-7"
        onTaskListChange={props.onTaskListChange}
      />
    </div>
  );
}
