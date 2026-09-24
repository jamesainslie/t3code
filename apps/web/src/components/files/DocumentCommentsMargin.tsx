import type { ThreadDocumentComment, ThreadDocumentCommentAnchor } from "@t3tools/contracts";
import {
  CircleCheckIcon,
  MessageSquareIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef, useState } from "react";

import { resolveAssistantCitationRange } from "~/lib/assistantTextSelection";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { layoutMarginCards } from "./documentComments.logic";

/** A comment being written: anchored to the live selection until it is saved. */
export type DocumentCommentDraft = {
  readonly id: string;
  readonly anchor: ThreadDocumentCommentAnchor;
  readonly range: Range;
};

export interface DocumentCommentActions {
  add: (input: { commentId: string; anchor: ThreadDocumentCommentAnchor; body: string }) => void;
  update: (commentId: string, body: string) => void;
  remove: (commentId: string) => void;
  resolve: (commentId: string) => void;
  reopen: (commentId: string) => void;
}

const HIGHLIGHT_NAME = "t3-document-comment";
const ACTIVE_HIGHLIGHT_NAME = "t3-document-comment-active";
const ESTIMATED_CARD_HEIGHT = 64;
const MARKER_HEIGHT = 22;

type AnchorLayout = {
  readonly tops: ReadonlyMap<string, number>;
  readonly ranges: ReadonlyMap<string, Range>;
  readonly detached: ReadonlySet<string>;
};

const EMPTY_LAYOUT: AnchorLayout = { tops: new Map(), ranges: new Map(), detached: new Set() };

function lineLabel(anchor: ThreadDocumentCommentAnchor): string {
  return anchor.startLine === anchor.endLine
    ? `L${anchor.startLine}`
    : `L${anchor.startLine} to L${anchor.endLine}`;
}

/** Replaces this surface's ranges in a shared highlight without disturbing other owners. */
function paintHighlight(name: string, ranges: ReadonlyArray<Range>): () => void {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") {
    return () => {};
  }
  const highlight = new Highlight(...ranges);
  CSS.highlights.set(name, highlight);
  return () => {
    if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
  };
}

/**
 * Margin comments for one rendered document. Cards sit beside the passage they
 * anchor to in a rail when there is room, and collapse to markers that open the
 * card when the pane is narrow. A comment whose passage is gone stays reachable
 * in a Detached group at the top.
 */
export function DocumentCommentsMargin({
  container,
  source,
  contents,
  comments,
  draft,
  wide,
  actions,
  onDraftDone,
}: {
  container: HTMLElement | null;
  source: HTMLElement | null;
  contents: string;
  comments: ReadonlyArray<ThreadDocumentComment>;
  draft: DocumentCommentDraft | null;
  wide: boolean;
  actions: DocumentCommentActions;
  onDraftDone: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [layoutVersion, relayout] = useReducer((version: number) => version + 1, 0);
  const [layout, setLayout] = useState<AnchorLayout>(EMPTY_LAYOUT);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const cardElements = useRef(new Map<string, HTMLElement>());
  const commentAtPoint = useEffectEvent((node: Node, offset: number) => {
    for (const [id, range] of layout.ranges) {
      if (range.isPointInRange(node, offset)) return id;
    }
    return null;
  });

  // Async content (Shiki, KaTeX, Mermaid, images) and pane resizes move passages.
  useEffect(() => {
    if (!container || !source) return;
    const observer = new ResizeObserver(relayout);
    observer.observe(container);
    observer.observe(source);
    return () => observer.disconnect();
  }, [container, source]);

  // Measuring the rendered passages is the external system this syncs with.
  useLayoutEffect(() => {
    if (!container || !source) return;
    const origin = container.getBoundingClientRect().top;
    const tops = new Map<string, number>();
    const ranges = new Map<string, Range>();
    const detached = new Set<string>();
    for (const comment of comments) {
      const range = resolveAssistantCitationRange(source, comment.anchor);
      if (!range) {
        detached.add(comment.id);
        continue;
      }
      ranges.set(comment.id, range);
      tops.set(comment.id, range.getBoundingClientRect().top - origin);
    }
    if (draft) {
      ranges.set(draft.id, draft.range);
      tops.set(draft.id, draft.range.getBoundingClientRect().top - origin);
    }
    setLayout({ tops, ranges, detached });
  }, [comments, contents, container, draft, layoutVersion, source]);

  // Cards size to their text, so push-down needs their measured heights.
  useLayoutEffect(() => {
    const measured = new Map<string, number>();
    for (const [id, element] of cardElements.current) measured.set(id, element.offsetHeight);
    const changed =
      measured.size !== heights.size ||
      [...measured].some(([id, height]) => heights.get(id) !== height);
    if (changed) setHeights(measured);
  });

  useEffect(() => {
    const open = comments
      .filter((comment) => comment.status === "open" && comment.id !== activeId)
      .flatMap((comment) => layout.ranges.get(comment.id) ?? []);
    const active = activeId ? layout.ranges.get(activeId) : undefined;
    const draftRange = draft ? [draft.range] : [];
    const clearNormal = paintHighlight(HIGHLIGHT_NAME, [...open, ...draftRange]);
    const clearActive = paintHighlight(ACTIVE_HIGHLIGHT_NAME, active ? [active] : []);
    return () => {
      clearNormal();
      clearActive();
    };
  }, [activeId, comments, draft, layout]);

  // Clicking highlighted text opens its comment.
  useEffect(() => {
    if (!source) return;
    const onClick = (event: MouseEvent) => {
      if (window.getSelection()?.isCollapsed === false) return;
      const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
      const id = caret ? commentAtPoint(caret.offsetNode, caret.offset) : null;
      if (id) setActiveId(id);
    };
    source.addEventListener("click", onClick);
    return () => source.removeEventListener("click", onClick);
  }, [source]);

  const detached = comments.filter((comment) => layout.detached.has(comment.id));
  const anchored = comments.filter((comment) => layout.tops.has(comment.id));
  const items = [
    ...detached.map((comment) => ({ id: comment.id, top: 0 })),
    ...anchored.map((comment) => ({ id: comment.id, top: layout.tops.get(comment.id) ?? 0 })),
    ...(draft ? [{ id: draft.id, top: layout.tops.get(draft.id) ?? 0 }] : []),
  ];
  const tops = layoutMarginCards(
    items.map((item) => ({
      ...item,
      height: wide ? (heights.get(item.id) ?? ESTIMATED_CARD_HEIGHT) : MARKER_HEIGHT,
    })),
    wide ? 8 : 4,
  );
  const cardRef = (id: string) => (element: HTMLElement | null) => {
    if (element) cardElements.current.set(id, element);
    else cardElements.current.delete(id);
  };
  const draftCard = draft ? (
    <DocumentCommentEditor
      label={lineLabel(draft.anchor)}
      initialBody=""
      submitLabel="Comment"
      onSubmit={(body) => {
        actions.add({ commentId: draft.id, anchor: draft.anchor, body });
        onDraftDone();
      }}
      onCancel={onDraftDone}
    />
  ) : null;
  const commentCard = (comment: ThreadDocumentComment) => (
    <DocumentCommentCard
      comment={comment}
      detached={layout.detached.has(comment.id)}
      active={activeId === comment.id}
      onActivate={() => setActiveId(comment.id)}
      onDeactivate={() => setActiveId((current) => (current === comment.id ? null : current))}
      actions={actions}
    />
  );

  if (wide) {
    return (
      <div className="relative w-72 shrink-0" data-document-comments-rail="">
        {[...detached, ...anchored].map((comment) => (
          <div
            key={comment.id}
            ref={cardRef(comment.id)}
            className="absolute inset-x-0 pe-3"
            style={{ top: tops.get(comment.id) ?? 0 }}
          >
            {commentCard(comment)}
          </div>
        ))}
        {draft ? (
          <div
            ref={cardRef(draft.id)}
            className="absolute inset-x-0 pe-3"
            style={{ top: tops.get(draft.id) ?? 0 }}
          >
            {draftCard}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-y-0 end-0 w-7"
      data-document-comments-rail=""
    >
      {[...detached, ...anchored].map((comment, index) => (
        <Popover
          key={comment.id}
          open={activeId === comment.id}
          onOpenChange={(open) => setActiveId(open ? comment.id : null)}
        >
          <PopoverTrigger
            className={cn(
              "pointer-events-auto absolute end-1 flex h-5 min-w-5 cursor-pointer items-center justify-center gap-0.5 rounded-full border px-1 text-[10px] font-medium tabular-nums shadow-xs",
              comment.status === "resolved"
                ? "border-border bg-muted text-muted-foreground"
                : "border-warning/40 bg-warning-surface text-warning-foreground",
            )}
            style={{ top: tops.get(comment.id) ?? 0 }}
            aria-label={`Comment ${index + 1}: ${comment.body}`}
          >
            <MessageSquareIcon aria-hidden className="size-3" />
            {index + 1}
          </PopoverTrigger>
          <PopoverPopup side="left" align="start" className="w-72" viewportClassName="p-0">
            {commentCard(comment)}
          </PopoverPopup>
        </Popover>
      ))}
      {draft ? (
        <Popover open onOpenChange={(open) => (open ? undefined : onDraftDone())}>
          <PopoverTrigger
            className="pointer-events-auto absolute end-1 flex size-5 items-center justify-center rounded-full border border-warning/40 bg-warning-surface text-warning-foreground"
            style={{ top: tops.get(draft.id) ?? 0 }}
            aria-label="New comment"
          >
            <MessageSquareIcon aria-hidden className="size-3" />
          </PopoverTrigger>
          <PopoverPopup side="left" align="start" className="w-72" viewportClassName="p-0">
            {draftCard}
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}

function DocumentCommentCard({
  comment,
  detached,
  active,
  onActivate,
  onDeactivate,
  actions,
}: {
  comment: ThreadDocumentComment;
  detached: boolean;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  actions: DocumentCommentActions;
}) {
  const [editing, setEditing] = useState(false);
  const resolved = comment.status === "resolved";

  if (editing) {
    return (
      <DocumentCommentEditor
        label={lineLabel(comment.anchor)}
        initialBody={comment.body}
        submitLabel="Save"
        onSubmit={(body) => {
          if (body !== comment.body) actions.update(comment.id, body);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-2.5 text-xs text-card-foreground shadow-xs/5",
        active ? "border-warning/60 ring-2 ring-warning/20" : "border-border",
        resolved && !active && "opacity-70",
      )}
      data-document-comment={comment.id}
      aria-label={`Comment on ${lineLabel(comment.anchor)}`}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDeactivate();
      }}
    >
      <header className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {detached ? (
          <UnlinkIcon aria-hidden className="size-3" />
        ) : (
          <MessageSquareIcon aria-hidden className="size-3" />
        )}
        <span className="tabular-nums">{lineLabel(comment.anchor)}</span>
        {detached ? <span>· passage changed</span> : null}
        {resolved ? (
          <span className="ms-auto inline-flex items-center gap-1 text-success-foreground">
            <CircleCheckIcon aria-hidden className="size-3" />
            Resolved
          </span>
        ) : null}
      </header>
      {detached ? (
        <p className="mb-1 line-clamp-2 border-s-2 border-border ps-1.5 text-muted-foreground italic">
          {comment.anchor.text}
        </p>
      ) : null}
      <p className={cn("whitespace-pre-wrap break-words", !active && "line-clamp-3")}>
        {comment.body}
      </p>
      {resolved && comment.resolution ? (
        <p
          className={cn(
            "mt-1.5 border-t border-border pt-1.5 whitespace-pre-wrap text-muted-foreground",
            !active && "line-clamp-2",
          )}
        >
          {comment.resolution}
        </p>
      ) : null}
      {active ? (
        <footer className="mt-2 flex items-center gap-1">
          {resolved ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                actions.reopen(comment.id);
              }}
            >
              <RotateCcwIcon aria-hidden className="size-3.5" />
              Reopen
            </Button>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                actions.resolve(comment.id);
              }}
            >
              <CircleCheckIcon aria-hidden className="size-3.5" />
              Resolve
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className="ms-auto"
            aria-label="Edit comment"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            <PencilIcon aria-hidden className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete comment"
            onClick={(event) => {
              event.stopPropagation();
              actions.remove(comment.id);
            }}
          >
            <Trash2Icon aria-hidden className="size-3.5" />
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

/**
 * The comment form. It takes focus on mount without scrolling: a new card
 * is committed at the top of the rail and only moved beside its passage once
 * the parent has measured, so a scrolling focus would throw the document to
 * the top and leave the reader hunting for the line they just selected.
 */
export function DocumentCommentEditor({
  label,
  initialBody,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initialBody: string;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    textarea.current?.focus({ preventScroll: true });
  }, []);
  return (
    <form
      className="rounded-lg border border-warning/60 bg-card p-2.5 text-xs shadow-xs/5 ring-2 ring-warning/20"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <p className="mb-1.5 text-[11px] text-muted-foreground tabular-nums">{label}</p>
      <Textarea
        ref={textarea}
        size="sm"
        value={body}
        aria-label="Comment"
        placeholder="Add a comment for the agent"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && trimmed) {
            event.preventDefault();
            onSubmit(trimmed);
          }
        }}
      />
      <div className="mt-2 flex justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!trimmed}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
