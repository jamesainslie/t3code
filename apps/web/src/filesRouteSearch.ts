export interface FilesRouteSearch {
  file?: string;
}

export function parseFilesRouteSearch(raw: Record<string, unknown>): FilesRouteSearch {
  const file = typeof raw.file === "string" && raw.file.length > 0 ? raw.file : undefined;
  return file ? { file } : {};
}

export function stripFilesSearchParams(search: Record<string, unknown>): Record<string, unknown> {
  const { file: _, ...rest } = search;
  return rest;
}
