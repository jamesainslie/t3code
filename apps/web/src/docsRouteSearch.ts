export type DocsMode = "preview" | "browser";

export interface DocsRouteSearch {
  docs?: "1" | undefined;
  docsPath?: string | undefined;
  docsMode?: DocsMode | undefined;
}

function isDocsOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

const VALID_MODES = new Set<string>(["preview", "browser"]);

function normalizeDocsMode(value: unknown): DocsMode | undefined {
  if (typeof value !== "string") return undefined;
  return VALID_MODES.has(value) ? (value as DocsMode) : undefined;
}

export function stripDocsSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "docs" | "docsPath" | "docsMode"> {
  const { docs: _docs, docsPath: _docsPath, docsMode: _docsMode, ...rest } = params;
  return rest as Omit<T, "docs" | "docsPath" | "docsMode">;
}

export function parseDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  const docs = isDocsOpenValue(search.docs) ? "1" : undefined;
  const docsPath = docs ? normalizeSearchString(search.docsPath) : undefined;
  const docsMode = docs ? normalizeDocsMode(search.docsMode) : undefined;

  return {
    ...(docs ? { docs } : {}),
    ...(docsPath ? { docsPath } : {}),
    ...(docsMode ? { docsMode } : {}),
  };
}
