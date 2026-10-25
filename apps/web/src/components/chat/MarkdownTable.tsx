import { Check, Copy } from "lucide";
import { WrapTextIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { getClientSettings } from "../../hooks/useSettings";
import {
  serializeTableElementToCsv,
  serializeTableElementToMarkdown,
} from "../../markdown-clipboard";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { reportMarkdownActionFailure } from "./markdownActionFailure";

/**
 * Wrapped cells fold long content within a readable width. Unwrapped cells stay on one
 * line at full width and the table scrolls sideways, so nothing is cut off either way.
 * Starts from the word wrap setting, like code blocks.
 */
export function MarkdownTable({ children, ...props }: ComponentProps<"table">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [wrapped, setWrapped] = useState(() => getClientSettings().wordWrap);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapLabel = wrapped ? "Disable line wrap" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy table";

  const handleCopy = (format: "markdown" | "csv") => {
    const table = containerRef.current?.querySelector("table");
    if (!table || typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    const text =
      format === "markdown"
        ? serializeTableElementToMarkdown(table)
        : serializeTableElementToCsv(table);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch((cause) => {
        reportMarkdownActionFailure({ operation: "copy-table", format }, cause);
      });
  };

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="chat-markdown-table-container"
      data-wrap={wrapped ? "true" : "false"}
    >
      <ScrollArea radius="none" chainVerticalScroll scrollFade className="w-full max-w-full">
        <table {...props}>{children}</table>
      </ScrollArea>
      <div className="mt-0.5 flex items-center justify-between select-none">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={wrapped ? "secondary" : "ghost-muted"}
                size="icon-xs"
                aria-pressed={wrapped}
                onClick={() => setWrapped((value) => !value)}
                aria-label={wrapLabel}
              />
            }
          >
            <WrapTextIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top">{wrapLabel}</TooltipPopup>
        </Tooltip>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="icon-xs"
                      aria-label={copyLabel}
                    />
                  }
                />
              }
            >
              <MorphIcon className="size-3" icon={copied ? Check : Copy} />
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuItem onClick={() => handleCopy("markdown")}>Copy as Markdown</MenuItem>
            <MenuItem onClick={() => handleCopy("csv")}>Copy as CSV</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
