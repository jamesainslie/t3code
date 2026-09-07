import * as Schema from "effect/Schema";
import { IsoDateTime, ProjectId, ThreadId } from "./baseSchemas.ts";
import { ProjectSyncMapping, ProjectSyncRecord } from "./orchestration.ts";

export const ProjectSyncConfiguration = Schema.Struct({
  sourceHome: Schema.NullOr(Schema.String),
  sourceId: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  hour: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(23)),
  timezone: Schema.String,
  lastAttemptAt: Schema.NullOr(IsoDateTime),
  lastSuccessAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
  mappings: Schema.Array(ProjectSyncMapping),
  lastJournalId: Schema.optional(Schema.String),
});
export type ProjectSyncConfiguration = typeof ProjectSyncConfiguration.Type;

export const ProjectSyncPreview = Schema.Struct({
  sourceHome: Schema.String,
  sourceId: Schema.String,
  contentHash: Schema.String,
  projects: Schema.Array(
    Schema.Struct({
      sourceProjectId: ProjectId,
      title: Schema.String,
      workspaceRoot: Schema.String,
      threadCount: Schema.Int,
      projectId: Schema.NullOr(ProjectId),
      existing: Schema.Boolean,
      warnings: Schema.Array(Schema.String),
    }),
  ),
});
export type ProjectSyncPreview = typeof ProjectSyncPreview.Type;

export const ProjectSyncRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("status") }),
  Schema.Struct({
    operation: Schema.Literal("preview"),
    sourceHome: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    operation: Schema.Literal("import"),
    sourceHome: Schema.String,
    contentHash: Schema.String,
    mappings: Schema.Array(ProjectSyncMapping),
    nightly: Schema.Boolean,
  }),
  Schema.Struct({ operation: Schema.Literal("syncNow") }),
  Schema.Struct({
    operation: Schema.Literal("configure"),
    enabled: Schema.Boolean,
    hour: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(23)),
  }),
  Schema.Struct({ operation: Schema.Literal("undo"), batchId: Schema.String }),
  Schema.Struct({ operation: Schema.Literal("continue"), threadId: ThreadId }),
  Schema.Struct({ operation: Schema.Literal("prepareRestore"), backupId: Schema.String }),
  Schema.Struct({ operation: Schema.Literal("cancelRestore") }),
]);
export type ProjectSyncRequest = typeof ProjectSyncRequest.Type;

export const ProjectSyncResponse = Schema.Struct({
  configuration: ProjectSyncConfiguration,
  history: Schema.Array(ProjectSyncRecord),
  activeBatchId: Schema.NullOr(Schema.String),
  defaultSourceHome: Schema.String,
  backups: Schema.Array(Schema.Struct({ id: Schema.String, createdAt: IsoDateTime })),
  restorePending: Schema.Boolean,
  preview: Schema.optional(ProjectSyncPreview),
  threadId: Schema.optional(ThreadId),
});
export type ProjectSyncResponse = typeof ProjectSyncResponse.Type;

export class ProjectSyncError extends Schema.TaggedErrorClass<ProjectSyncError>()(
  "ProjectSyncError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}
