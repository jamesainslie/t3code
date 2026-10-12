const MAX_SUMMARY_LENGTH = 200;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/g;
// Long unbroken runs look like tokens, signatures or hashes; none help a reader.
const TOKEN_PATTERN = /[A-Za-z0-9_-]{24,}/g;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,40}$/;

interface UpdaterErrorContext {
  readonly causeName: string;
  readonly causeSummary?: string;
  readonly causeCode?: string;
  readonly httpStatus?: number;
}

function originAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return "[url]";
  }
}

/**
 * Log annotations that say why an updater operation failed without carrying
 * anything secret: the error's name, code and HTTP status, and the first line
 * of its message with URLs cut to origin and path, token-like strings masked,
 * and the length bounded. Feed responses (GitHub's error pages, for example)
 * follow on later lines and are dropped.
 */
export function updaterErrorContext(cause: unknown): UpdaterErrorContext {
  if (!(cause instanceof Error)) {
    return { causeName: cause === null ? "null" : typeof cause };
  }
  const details = cause as Error & { readonly code?: unknown; readonly statusCode?: unknown };
  const firstLine = (cause.message.split("\n")[0] ?? "")
    .replace(URL_PATTERN, originAndPath)
    .replace(TOKEN_PATTERN, "[redacted]")
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);
  return {
    causeName: cause.name,
    ...(firstLine ? { causeSummary: firstLine } : {}),
    ...(typeof details.code === "string" && ERROR_CODE_PATTERN.test(details.code)
      ? { causeCode: details.code }
      : {}),
    ...(typeof details.statusCode === "number" ? { httpStatus: details.statusCode } : {}),
  };
}
