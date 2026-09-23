import {
  ThreadDocumentComment,
  ThreadDocumentCommentAnchor,
  ThreadDocumentCommentId,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "./Errors.ts";

import * as Layer from "effect/Layer";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

export const ProjectionThreadDocumentComment = Schema.Struct({
  threadId: ThreadId,
  ...ThreadDocumentComment.fields,
});
export type ProjectionThreadDocumentComment = typeof ProjectionThreadDocumentComment.Type;

export const ProjectionThreadDocumentCommentKey = Schema.Struct({
  threadId: ThreadId,
  commentId: ThreadDocumentCommentId,
});
export type ProjectionThreadDocumentCommentKey = typeof ProjectionThreadDocumentCommentKey.Type;

export const ProjectionThreadDocumentCommentsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProjectionThreadDocumentCommentsInput =
  typeof ProjectionThreadDocumentCommentsInput.Type;

export const ProjectionThreadDocumentCommentDbRow = ProjectionThreadDocumentComment.mapFields(
  Struct.assign({
    anchor: Schema.fromJsonString(ThreadDocumentCommentAnchor),
  }),
);

export class ProjectionThreadDocumentCommentRepository extends Context.Service<
  ProjectionThreadDocumentCommentRepository,
  {
    readonly upsert: (
      row: ProjectionThreadDocumentComment,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly getById: (
      input: ProjectionThreadDocumentCommentKey,
    ) => Effect.Effect<Option.Option<ProjectionThreadDocumentComment>, ProjectionRepositoryError>;
    readonly listByThreadId: (
      input: ProjectionThreadDocumentCommentsInput,
    ) => Effect.Effect<ReadonlyArray<ProjectionThreadDocumentComment>, ProjectionRepositoryError>;
    readonly delete: (
      input: ProjectionThreadDocumentCommentKey,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly deleteByThreadId: (
      input: ProjectionThreadDocumentCommentsInput,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
  }
>()("t3/persistence/ProjectionThreadDocumentComments/ProjectionThreadDocumentCommentRepository") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadDocumentCommentDbRow,
    execute: (row) => sql`
      INSERT INTO projection_thread_document_comments (
        thread_id,
        comment_id,
        file_path,
        anchor_json,
        body,
        status,
        resolution,
        created_at,
        updated_at,
        resolved_at
      )
      VALUES (
        ${row.threadId},
        ${row.id},
        ${row.filePath},
        ${row.anchor},
        ${row.body},
        ${row.status},
        ${row.resolution},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.resolvedAt}
      )
      ON CONFLICT (thread_id, comment_id)
      DO UPDATE SET
        file_path = excluded.file_path,
        anchor_json = excluded.anchor_json,
        body = excluded.body,
        status = excluded.status,
        resolution = excluded.resolution,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        resolved_at = excluded.resolved_at
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: ProjectionThreadDocumentCommentKey,
    Result: ProjectionThreadDocumentCommentDbRow,
    execute: ({ threadId, commentId }) => sql`
      SELECT
        thread_id AS "threadId",
        comment_id AS "id",
        file_path AS "filePath",
        anchor_json AS "anchor",
        body,
        status,
        resolution,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        resolved_at AS "resolvedAt"
      FROM projection_thread_document_comments
      WHERE thread_id = ${threadId}
        AND comment_id = ${commentId}
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ProjectionThreadDocumentCommentsInput,
    Result: ProjectionThreadDocumentCommentDbRow,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        comment_id AS "id",
        file_path AS "filePath",
        anchor_json AS "anchor",
        body,
        status,
        resolution,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        resolved_at AS "resolvedAt"
      FROM projection_thread_document_comments
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC, comment_id ASC
    `,
  });

  const deleteRow = SqlSchema.void({
    Request: ProjectionThreadDocumentCommentKey,
    execute: ({ threadId, commentId }) => sql`
      DELETE FROM projection_thread_document_comments
      WHERE thread_id = ${threadId}
        AND comment_id = ${commentId}
    `,
  });

  const deleteRows = SqlSchema.void({
    Request: ProjectionThreadDocumentCommentsInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_document_comments
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadDocumentCommentRepository["Service"]["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadDocumentCommentRepository.upsert:query"),
      ),
    );

  const getById: ProjectionThreadDocumentCommentRepository["Service"]["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadDocumentCommentRepository.getById:query"),
      ),
    );

  const listByThreadId: ProjectionThreadDocumentCommentRepository["Service"]["listByThreadId"] = (
    input,
  ) =>
    listRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadDocumentCommentRepository.listByThreadId:query"),
      ),
    );

  const deleteComment: ProjectionThreadDocumentCommentRepository["Service"]["delete"] = (input) =>
    deleteRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadDocumentCommentRepository.delete:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadDocumentCommentRepository["Service"]["deleteByThreadId"] =
    (input) =>
      deleteRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadDocumentCommentRepository.deleteByThreadId:query"),
        ),
      );

  return {
    upsert,
    getById,
    listByThreadId,
    delete: deleteComment,
    deleteByThreadId,
  } satisfies ProjectionThreadDocumentCommentRepository["Service"];
});

export const layer = Layer.effect(ProjectionThreadDocumentCommentRepository, make);
