import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, HistoryIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

import { useContinuedInThreads, useThreadShell } from "~/state/entities";
import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Inline links only fit a wide header; narrower headers get one menu so the
// thread title keeps its space.
const WIDE_CLASS = "hidden shrink @3xl/header-actions:flex";
const COMPACT_CLASS = "@3xl/header-actions:hidden";
const LINK_CLASS =
  "inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const HISTORY_LABEL = "Thread history links";
// Archived threads leave the client shell, so this is the usual label for an
// archived source. The route cannot open a thread without a shell, so it stays
// plain text. Deleted sources read the same way.
const UNKNOWN_SOURCE_LABEL = "Continued from another thread";

/**
 * Breadcrumb items after a thread's title: the thread it continues and the
 * threads continuing it. `continuedFromThreadId` comes from the thread itself,
 * so an open archived thread (which has no shell) still links back.
 */
export const ThreadContinuationBreadcrumbs = memo(function ThreadContinuationBreadcrumbs({
  threadRef,
  continuedFromThreadId,
}: {
  threadRef: ScopedThreadRef;
  continuedFromThreadId: ThreadId | null;
}) {
  const navigate = useNavigate();
  const sourceRef = useMemo(
    () =>
      continuedFromThreadId === null
        ? null
        : scopeThreadRef(threadRef.environmentId, continuedFromThreadId),
    [continuedFromThreadId, threadRef.environmentId],
  );
  const source = useThreadShell(sourceRef);
  // Built from live shells, so archived continuations are not listed.
  const continuedIn = useContinuedInThreads(threadRef);
  const openThread = useCallback(
    (threadId: ThreadId) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: threadRef.environmentId, threadId },
      }),
    [navigate, threadRef.environmentId],
  );
  if (continuedFromThreadId === null && continuedIn.length === 0) return null;
  const onlyContinuation = continuedIn.length === 1 ? continuedIn[0] : undefined;

  return (
    <>
      {continuedFromThreadId !== null ? (
        <>
          <WorkspaceBreadcrumbSeparator className={WIDE_CLASS}>
            <WorkspaceBreadcrumbText>·</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
          <WorkspaceBreadcrumbItem className={WIDE_CLASS}>
            {source === null ? (
              <WorkspaceBreadcrumbText>{UNKNOWN_SOURCE_LABEL}</WorkspaceBreadcrumbText>
            ) : (
              <ContinuationLink
                prefix="Continued from"
                title={source.title}
                onOpen={() => openThread(source.id)}
              />
            )}
          </WorkspaceBreadcrumbItem>
        </>
      ) : null}
      {continuedIn.length > 0 ? (
        <>
          <WorkspaceBreadcrumbSeparator className={WIDE_CLASS}>
            <WorkspaceBreadcrumbText>·</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
          <WorkspaceBreadcrumbItem className={WIDE_CLASS}>
            {onlyContinuation !== undefined ? (
              <ContinuationLink
                prefix="Continued in"
                title={onlyContinuation.title}
                onOpen={() => openThread(onlyContinuation.threadId)}
              />
            ) : (
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Continued in ${continuedIn.length} threads`}
                      className={LINK_CLASS}
                    />
                  }
                >
                  <WorkspaceBreadcrumbText>
                    Continued in {continuedIn.length} threads
                  </WorkspaceBreadcrumbText>
                  <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
                </MenuTrigger>
                <MenuPopup align="start" aria-label="Threads continuing this one">
                  {continuedIn.map((continuation) => (
                    <MenuItem
                      key={continuation.threadId}
                      onClick={() => openThread(continuation.threadId)}
                    >
                      <MenuItemLabel>{continuation.title}</MenuItemLabel>
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            )}
          </WorkspaceBreadcrumbItem>
        </>
      ) : null}
      <WorkspaceBreadcrumbItem className={COMPACT_CLASS}>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button size="icon-xs" variant="ghost-muted" aria-label={HISTORY_LABEL} />
                  }
                />
              }
            >
              <HistoryIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="top">{HISTORY_LABEL}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="start" aria-label={HISTORY_LABEL}>
            {continuedFromThreadId === null ? null : source === null ? (
              <MenuItem disabled>
                <MenuItemLabel>{UNKNOWN_SOURCE_LABEL}</MenuItemLabel>
              </MenuItem>
            ) : (
              <MenuItem onClick={() => openThread(source.id)}>
                <MenuItemLabel>Continued from {source.title}</MenuItemLabel>
              </MenuItem>
            )}
            {continuedIn.map((continuation) => (
              <MenuItem
                key={continuation.threadId}
                onClick={() => openThread(continuation.threadId)}
              >
                <MenuItemLabel>Continued in {continuation.title}</MenuItemLabel>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </WorkspaceBreadcrumbItem>
    </>
  );
});

function ContinuationLink({
  prefix,
  title,
  onOpen,
}: {
  prefix: string;
  title: string;
  onOpen: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${prefix} ${title}`}
            onClick={onOpen}
            className={LINK_CLASS}
          />
        }
      >
        <WorkspaceBreadcrumbText className="shrink-0">{prefix}</WorkspaceBreadcrumbText>
        <WorkspaceBreadcrumbText className="max-w-24">{title}</WorkspaceBreadcrumbText>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {prefix} {title}
      </TooltipPopup>
    </Tooltip>
  );
}
