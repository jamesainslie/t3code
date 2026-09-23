import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { Citation } from "@t3tools/contracts";
import { isDocumentCitation, serializeCitation } from "@t3tools/shared/assistantCitations";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileTextIcon, PencilIcon, QuoteIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  findAssistantCitationSourceAnchor,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { cn } from "~/lib/utils";
import {
  assistantCitationHash,
  assistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";
import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES,
} from "../composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { AssistantCitationCommentEditor } from "./AssistantCitationCommentEditor";
import { observeAssistantCitationCommentSource } from "./AssistantCitationSource";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useRightPanelStore } from "../../rightPanelStore";

const CITATION_ACTION_BUTTON_CLASS_NAME = cn(
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  "text-current hover:bg-[color-mix(in_oklab,var(--context-chip-accent)_17%,transparent)] hover:text-current",
);

export function AssistantCitationChip({
  citation,
  composer = false,
  commentEditor,
}: {
  citation: Citation;
  composer?: boolean;
  commentEditor?: {
    open: boolean;
    sourceAnchor?: AssistantCitationSourceAnchor | undefined;
    onOpenChange: (open: boolean) => void;
    onCancel?: () => void;
    onSave: (comment: string) => boolean;
    onSaveAndSend?: (comment: string) => boolean;
  };
}) {
  const navigate = useNavigate();
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const commentOpen = commentEditor?.open ?? false;
  const sourceAnchor = commentEditor?.sourceAnchor;
  const onSourceUnavailable = useEffectEvent(() => {
    if (sourceAnchor) commentEditor?.onOpenChange(false);
  });
  useEffect(() => {
    if (!commentOpen) return;
    const anchor = sourceAnchor ?? findAssistantCitationSourceAnchor(document, citation);
    if (!anchor) return;
    return observeAssistantCitationCommentSource({
      anchor,
      citation,
      onUnavailable: onSourceUnavailable,
    });
  }, [citation, commentOpen, sourceAnchor]);
  // A multi-line selection's bounding box spans the full message width; anchor
  // the bubble to the selection's last line, where the pointer released.
  const popupAnchor = sourceAnchor
    ? {
        contextElement: sourceAnchor.source,
        getBoundingClientRect: () => {
          const rects = sourceAnchor.range.getClientRects();
          return rects.item(rects.length - 1) ?? sourceAnchor.range.getBoundingClientRect();
        },
      }
    : undefined;
  const preview = (citation.comment?.trim() || citation.text).replace(/\s+/g, " ");
  const label = preview.length > 64 ? `${preview.slice(0, 64)}…` : preview;
  const sourceContent = (
    <>
      {isDocumentCitation(citation) ? (
        <FileTextIcon aria-hidden="true" className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
      ) : (
        <QuoteIcon aria-hidden="true" className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
      )}
      <span className={cn(COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME, "max-w-[16em]")}>{label}</span>
    </>
  );
  const sourceLinkClassName = cn(
    "inline-flex h-full min-w-0 items-center gap-[0.33em] rounded-sm text-inherit no-underline focus-visible:outline-2 focus-visible:outline-[var(--contrast-foreground)]",
    !composer && "hover:bg-[color-mix(in_oklab,var(--context-chip-accent)_17%,transparent)]",
  );
  // A document quote opens its file at the quoted lines; an assistant quote scrolls to its message.
  const sourceLink = isDocumentCitation(citation) ? (
    <button
      type="button"
      className={cn(sourceLinkClassName, "cursor-pointer")}
      aria-label={`View quoted text in ${citation.filePath}: ${label}`}
      data-markdown-copy={serializeCitation(citation)}
      onClick={() =>
        useRightPanelStore
          .getState()
          .openFile(
            scopeThreadRef(citation.environmentId, citation.threadId),
            citation.filePath,
            citation.startLine,
          )
      }
    >
      {sourceContent}
    </button>
  ) : (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: citation.environmentId, threadId: citation.threadId }}
      hash={assistantCitationHash(citation)}
      data-markdown-copy={serializeCitation(citation)}
      resetScroll={false}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        void navigate(assistantCitationNavigation(citation));
      }}
      className={sourceLinkClassName}
      aria-label={`View cited assistant text: ${label}`}
    >
      {sourceContent}
    </Link>
  );
  return (
    <span
      className={cn(
        composer ? COMPOSER_INLINE_CHIP_CLASS_NAME : CHAT_INLINE_CHIP_CLASS_NAME,
        CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.citation,
      )}
      contentEditable={false}
      data-assistant-citation-chip="true"
      data-markdown-copy={serializeCitation(citation)}
    >
      {composer ? (
        sourceLink
      ) : (
        <Tooltip>
          <TooltipTrigger render={sourceLink} />
          <TooltipPopup side="top">View source</TooltipPopup>
        </Tooltip>
      )}
      {commentEditor ? (
        <Popover open={commentEditor.open} onOpenChange={commentEditor.onOpenChange}>
          <PopoverTrigger
            aria-label={citation.comment ? "Edit citation comment" : "Add comment to citation"}
            className={CITATION_ACTION_BUTTON_CLASS_NAME}
          >
            <PencilIcon aria-hidden="true" className="size-[0.85em]" />
          </PopoverTrigger>
          {commentEditor.open ? (
            <PopoverPopup
              {...composerFloatingLayerProps}
              side={sourceAnchor ? "bottom" : "top"}
              align="end"
              anchor={popupAnchor}
              initialFocus={() => {
                commentInputRef.current?.focus({ preventScroll: true });
                return false;
              }}
              aria-label="Edit citation comment"
              className="w-72 max-w-[calc(100vw-1rem)]"
              viewportClassName="p-3"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <AssistantCitationCommentEditor
                key={serializeCitation(citation)}
                citation={citation}
                inputRef={commentInputRef}
                onSubmit={(comment) => {
                  if (!commentEditor.onSave(comment)) return false;
                  commentEditor.onOpenChange(false);
                  return true;
                }}
                {...(commentEditor.onSaveAndSend
                  ? {
                      onSubmitAndSend: (comment: string) => {
                        if (!commentEditor.onSaveAndSend?.(comment)) return false;
                        commentEditor.onOpenChange(false);
                        return true;
                      },
                    }
                  : {})}
                onCancel={() => {
                  if (commentEditor.onCancel) {
                    commentEditor.onCancel();
                  } else {
                    commentEditor.onOpenChange(false);
                  }
                }}
              />
            </PopoverPopup>
          ) : null}
        </Popover>
      ) : null}
    </span>
  );
}
