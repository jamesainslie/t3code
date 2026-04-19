import { MarkdownConverter } from "@mdreview/core";
import type {
  FileAdapter as CoreFileAdapter,
  MessagingAdapter as CoreMessagingAdapter,
  StorageAdapter as CoreStorageAdapter,
} from "@mdreview/core";
import { useMemo } from "react";

export interface MdreviewAdapters {
  readonly file: CoreFileAdapter;
  readonly storage: CoreStorageAdapter;
  readonly messaging: CoreMessagingAdapter;
}

export interface MdreviewRendererProps {
  /**
   * Raw markdown source. The renderer converts this to HTML synchronously via
   * `@mdreview/core`'s {@link MarkdownConverter} and drops the result into a
   * `dangerouslySetInnerHTML` div.
   */
  readonly source: string;
  /**
   * Platform adapters. Retained as a prop so future renderer features
   * (comment writes, theme persistence, live IPC) can reach through to the
   * host; the current implementation only needs identity-stable adapters so
   * the memoized converter doesn't churn.
   */
  readonly adapters: MdreviewAdapters;
  /**
   * Optional theme identifier, attached to the root element as `data-theme`.
   * Downstream CSS (mdview's content stylesheet) picks the appropriate
   * palette based on this attribute.
   */
  readonly theme?: string;
}

/**
 * React 19 component that renders a markdown string as HTML using the same
 * rendering engine as the mdview browser extension and Electron app. The
 * {@link MarkdownConverter} instance is memoized against the `adapters`
 * identity, so long-lived panel mounts don't rebuild it every render.
 *
 * The `adapters` prop is currently unused by MarkdownConverter itself, but
 * future mdview features (interactive comments, theme persistence) hook
 * through the same adapters. We memoize on them now so the hook contract is
 * stable when those features land.
 */
export function MdreviewRenderer(
  props: MdreviewRendererProps,
): React.ReactElement {
  const { source, adapters, theme } = props;

  const converter = useMemo(
    () => new MarkdownConverter(),
    // Adapters identity-key'd: a new adapter bundle swaps the converter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapters],
  );

  const html = useMemo(
    () => converter.convert(source).html,
    [converter, source],
  );

  const rootProps: React.HTMLAttributes<HTMLDivElement> & {
    "data-theme"?: string;
  } = {
    className: "mdreview-host-root",
    dangerouslySetInnerHTML: { __html: html },
  };
  if (theme !== undefined) {
    rootProps["data-theme"] = theme;
  }

  return <div {...rootProps} />;
}
