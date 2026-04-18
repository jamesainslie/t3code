import { Effect, Schema } from "effect";
import {
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// Read markdown file (one-shot)

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  contents: Schema.String,
  relativePath: TrimmedNonEmptyString,
  size: NonNegativeInt,
  mtimeMs: Schema.Number,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export const ProjectReadFileError = Schema.Union([
  Schema.TaggedStruct("NotFound", { relativePath: Schema.String }),
  Schema.TaggedStruct("TooLarge", { relativePath: Schema.String }),
  Schema.TaggedStruct("PathOutsideRoot", { relativePath: Schema.String }),
  Schema.TaggedStruct("NotReadable", { relativePath: Schema.String }),
]);
export type ProjectReadFileError = typeof ProjectReadFileError.Type;

// Watch project files (stream)

export const ProjectFileEntry = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  size: Schema.Number,
  mtimeMs: Schema.Number,
  oversized: Schema.Boolean,
});
export type ProjectFileEntry = typeof ProjectFileEntry.Type;

export const ProjectFileWatchInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  globs: Schema.Array(Schema.String),
  ignoreGlobs: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(Effect.succeed([] as readonly string[])),
  ),
});
export type ProjectFileWatchInput = typeof ProjectFileWatchInput.Type;

export const ProjectFileChangeEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    files: Schema.Array(ProjectFileEntry),
  }),
  Schema.TaggedStruct("added", {
    relativePath: TrimmedNonEmptyString,
    size: Schema.Number,
    mtimeMs: Schema.Number,
  }),
  Schema.TaggedStruct("changed", {
    relativePath: TrimmedNonEmptyString,
    size: Schema.Number,
    mtimeMs: Schema.Number,
  }),
  Schema.TaggedStruct("removed", {
    relativePath: TrimmedNonEmptyString,
  }),
  Schema.TaggedStruct("turnTouchedDoc", {
    threadId: ThreadId,
    turnId: TurnId,
    paths: Schema.Array(Schema.String),
  }),
]);
export type ProjectFileChangeEvent = typeof ProjectFileChangeEvent.Type;

export const ProjectFileMonitorError = Schema.Union([
  Schema.TaggedStruct("PathOutsideRoot", { detail: Schema.String }),
  Schema.TaggedStruct("MonitorFailed", { detail: Schema.String }),
]);
export type ProjectFileMonitorError = typeof ProjectFileMonitorError.Type;

// Update frontmatter (one-shot write)

export const ProjectUpdateFrontmatterInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  frontmatter: Schema.Record(Schema.String, Schema.Unknown),
  expectedMtimeMs: Schema.optional(Schema.Number),
});
export type ProjectUpdateFrontmatterInput = typeof ProjectUpdateFrontmatterInput.Type;

export const ProjectUpdateFrontmatterResult = Schema.Struct({
  mtimeMs: Schema.Number,
});
export type ProjectUpdateFrontmatterResult = typeof ProjectUpdateFrontmatterResult.Type;

export const ProjectUpdateFrontmatterError = Schema.Union([
  Schema.TaggedStruct("FrontmatterInvalid", { relativePath: Schema.String }),
  Schema.TaggedStruct("ConcurrentModification", { relativePath: Schema.String }),
  Schema.TaggedStruct("PathOutsideRoot", { relativePath: Schema.String }),
  Schema.TaggedStruct("NotFound", { relativePath: Schema.String }),
]);
export type ProjectUpdateFrontmatterError = typeof ProjectUpdateFrontmatterError.Type;
