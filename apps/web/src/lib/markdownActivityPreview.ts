import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

export interface MarkdownActivityPreviewSignal {
  readonly key: string;
  readonly paths: readonly string[];
}

interface FindMarkdownActivityPreviewSignalInput {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly cwd: string | null;
  readonly turnId: TurnId | null | undefined;
}

interface CollectMarkdownActivityPreviewPathsInput {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly cwd: string | null;
}

const MAX_CHANGED_FILE_SCAN_DEPTH = 4;
const MAX_CHANGED_FILE_COUNT = 12;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitPathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function normalizePathSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeCwd(cwd: string): string {
  return normalizePathSeparators(cwd).replace(/\/+$/, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > MAX_CHANGED_FILE_SCAN_DEPTH || target.length >= MAX_CHANGED_FILE_COUNT) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= MAX_CHANGED_FILE_COUNT) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.file_path);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.relative_path);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.new_path);
  pushChangedFile(target, seen, record.oldPath);
  pushChangedFile(target, seen, record.old_path);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= MAX_CHANGED_FILE_COUNT) {
      return;
    }
  }
}

function extractChangedFiles(payload: unknown): string[] {
  const changedFiles: string[] = [];
  collectChangedFiles(payload, changedFiles, new Set(), 0);
  return changedFiles;
}

export function normalizeMarkdownPreviewPath(path: string, cwd: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedCwd = normalizeCwd(cwd);
  let candidate = normalizePathSeparators(trimmed);

  if (candidate.startsWith("file://")) {
    candidate = decodeURIComponent(candidate.slice("file://".length));
  }

  if (isAbsolutePath(candidate)) {
    const withSeparator = `${normalizedCwd}/`;
    if (candidate === normalizedCwd) {
      return null;
    }
    if (!candidate.startsWith(withSeparator)) {
      return null;
    }
    candidate = candidate.slice(withSeparator.length);
  }

  candidate = candidate.replace(/^\.\/+/, "");
  const segments = splitPathSegments(candidate);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const relativePath = segments.join("/");
  return isMarkdownPath(relativePath) ? relativePath : null;
}

function compareActivityOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (
    left.sequence !== undefined &&
    right.sequence !== undefined &&
    left.sequence !== right.sequence
  ) {
    return left.sequence - right.sequence;
  }
  if (left.sequence !== undefined && right.sequence === undefined) {
    return 1;
  }
  if (left.sequence === undefined && right.sequence !== undefined) {
    return -1;
  }
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  return createdAtComparison === 0 ? left.id.localeCompare(right.id) : createdAtComparison;
}

export function findMarkdownActivityPreviewSignal(
  input: FindMarkdownActivityPreviewSignalInput,
): MarkdownActivityPreviewSignal | null {
  if (!input.cwd || !input.turnId) {
    return null;
  }

  const matchingActivities = input.activities
    .filter((activity) => activity.turnId === input.turnId)
    .toSorted(compareActivityOrder);

  for (let index = matchingActivities.length - 1; index >= 0; index -= 1) {
    const activity = matchingActivities[index]!;
    const paths = extractChangedFiles(activity.payload)
      .map((path) => normalizeMarkdownPreviewPath(path, input.cwd!))
      .filter((path): path is string => path !== null);

    if (paths.length === 0) {
      continue;
    }

    const uniquePaths = Array.from(new Set(paths));
    return {
      key: `${input.turnId}:${activity.id}:${uniquePaths.join("\0")}`,
      paths: uniquePaths,
    };
  }

  return null;
}

export function collectMarkdownActivityPreviewPaths(
  input: CollectMarkdownActivityPreviewPathsInput,
): readonly string[] {
  if (!input.cwd) {
    return [];
  }

  const paths: string[] = [];
  const seen = new Set<string>();

  for (const activity of input.activities.toSorted(compareActivityOrder)) {
    for (const rawPath of extractChangedFiles(activity.payload)) {
      const relativePath = normalizeMarkdownPreviewPath(rawPath, input.cwd);
      if (!relativePath || seen.has(relativePath)) {
        continue;
      }
      seen.add(relativePath);
      paths.push(relativePath);
    }
  }

  return paths;
}
