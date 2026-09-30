import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

import { useContinuedInThreads, useThreadShell } from "~/state/entities";
import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Continuation links give way to the title when the header runs out of room.
const ITEM_CLASS = "hidden shrink @xl/header-actions:flex";
const LINK_CLASS =
  "inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Breadcrumb items after a thread's title: the thread it continues and the threads continuing it. */
export const ThreadContinuationBreadcrumbs = memo(function ThreadContinuationBreadcrumbs({
  threadRef,
}: {
  threadRef: ScopedThreadRef;
}) {
  const navigate = useNavigate();
  const sourceThreadId = useThreadShell(threadRef)?.continuedFromThreadId ?? null;
  const sourceRef = useMemo(
    () =>
      sourceThreadId === null ? null : scopeThreadRef(threadRef.environmentId, sourceThreadId),
    [sourceThreadId, threadRef.environmentId],
  );
  const source = useThreadShell(sourceRef);
  const continuedIn = useContinuedInThreads(threadRef);
  const openThread = useCallback(
    (threadId: ThreadId) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: threadRef.environmentId, threadId },
      }),
    [navigate, threadRef.environmentId],
  );
  const onlyContinuation = continuedIn.length === 1 ? continuedIn[0] : undefined;

  return (
    <>
      {sourceThreadId !== null ? (
        <>
          <WorkspaceBreadcrumbSeparator className={ITEM_CLASS}>
            <WorkspaceBreadcrumbText>·</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
          <WorkspaceBreadcrumbItem className={ITEM_CLASS}>
            {source === null ? (
              // The source was deleted or lives outside this client's shell.
              <WorkspaceBreadcrumbText>Continued from another thread</WorkspaceBreadcrumbText>
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
          <WorkspaceBreadcrumbSeparator className={ITEM_CLASS}>
            <WorkspaceBreadcrumbText>·</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbSeparator>
          <WorkspaceBreadcrumbItem className={ITEM_CLASS}>
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
        <WorkspaceBreadcrumbText className="max-w-40">{title}</WorkspaceBreadcrumbText>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {prefix} {title}
      </TooltipPopup>
    </Tooltip>
  );
}
