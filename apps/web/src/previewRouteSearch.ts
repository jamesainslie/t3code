export interface PreviewRouteSearch {
  preview?: string | undefined;
}

export function parsePreviewRouteSearch(raw: Record<string, unknown>): PreviewRouteSearch {
  const preview =
    typeof raw.preview === "string" && raw.preview.length > 0 ? raw.preview : undefined;
  return preview ? { preview } : {};
}

export function stripPreviewSearchParams(search: Record<string, unknown>): Record<string, unknown> {
  const { preview: _, ...rest } = search;
  return rest;
}

export function closePreviewRouteSearch(
  search: Record<string, unknown>,
): Record<string, unknown> & { preview: undefined } {
  return {
    ...stripPreviewSearchParams(search),
    preview: undefined,
  };
}
