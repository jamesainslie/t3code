/**
 * Fork-only orchestration schemas that layer `remoteHost` (and the
 * `deletedAt`-with-default on `OrchestrationProjectShell`) on top of the
 * upstream base definitions in `../orchestration.ts`.
 *
 * Each composed schema is exported under the SAME NAME as the upstream struct
 * it supersedes. The package barrel re-exports the fork module AFTER the
 * upstream module so these composed names override the `Base*` companions
 * for downstream consumers.
 *
 * Do not edit `../orchestration.ts` to add fork fields. Add them here so
 * upstream merges only need to rename the renamed-to-`Base*` structs if
 * upstream changes them.
 */
import { Schema } from "effect";
import { NonNegativeInt } from "../baseSchemas.ts";
import {
  BaseClientOrchestrationCommand,
  BaseDispatchableClientOrchestrationCommand,
  BaseOrchestrationEvent,
  BaseOrchestrationProject,
  BaseOrchestrationProjectShell,
  BaseOrchestrationReadModel,
  BaseOrchestrationShellSnapshot,
  BaseOrchestrationShellStreamEvent,
  BaseProjectCreateCommand,
  BaseProjectCreatedPayload,
  DispatchResult,
  InternalOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationReplayEventsInput,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadDetailSnapshot,
} from "../orchestration.ts";
import { ProjectForkFields, ProjectShellForkFields } from "./projectExtensions.ts";

// ---------------------------------------------------------------------------
// Leaf schemas: add fork-only fields via field-object composition.
// ---------------------------------------------------------------------------

export const OrchestrationProject = Schema.Struct({
  ...BaseOrchestrationProject.fields,
  ...ProjectForkFields,
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationProjectShell = Schema.Struct({
  ...BaseOrchestrationProjectShell.fields,
  ...ProjectShellForkFields,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const ProjectCreateCommand = Schema.Struct({
  ...BaseProjectCreateCommand.fields,
  ...ProjectForkFields,
});
export type ProjectCreateCommand = typeof ProjectCreateCommand.Type;

export const ProjectCreatedPayload = Schema.Struct({
  ...BaseProjectCreatedPayload.fields,
  ...ProjectForkFields,
});
export type ProjectCreatedPayload = typeof ProjectCreatedPayload.Type;

// ---------------------------------------------------------------------------
// Transitive container schemas: swap the affected inner schema reference so
// the composed fork fields propagate through the public type.
// ---------------------------------------------------------------------------

export const OrchestrationReadModel = Schema.Struct({
  ...BaseOrchestrationReadModel.fields,
  projects: Schema.Array(OrchestrationProject),
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  ...BaseOrchestrationShellSnapshot.fields,
  projects: Schema.Array(OrchestrationProjectShell),
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

// Rebuild the shell stream event union so `project-upserted` carries the
// composed `OrchestrationProjectShell`. `project-upserted` is the first
// member in the base union, so we replace index 0 via `mapMembers` and keep
// the remaining members verbatim — preserving the tuple-level inference TS
// needs to narrow `event.project` correctly.
export const OrchestrationShellStreamEvent = BaseOrchestrationShellStreamEvent.mapMembers(
  (members) => {
    const [, ...rest] = members;
    return [
      Schema.Struct({
        kind: Schema.Literal("project-upserted"),
        sequence: NonNegativeInt,
        project: OrchestrationProjectShell,
      }),
      ...rest,
    ] as const;
  },
);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

// ---------------------------------------------------------------------------
// Command unions: replace the single `project.create` member with the
// composed `ProjectCreateCommand`.
// ---------------------------------------------------------------------------

// `BaseProjectCreateCommand` is the first member of `BaseClientOrchestrationCommand`.
// Replace it positionally via `mapMembers` to preserve tuple-level inference.
export const ClientOrchestrationCommand = BaseClientOrchestrationCommand.mapMembers((members) => {
  const [, ...rest] = members;
  return [ProjectCreateCommand, ...rest] as const;
});
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

// Recompose the dispatchable union with the composed ProjectCreateCommand, then
// union with the internal commands to yield the full `OrchestrationCommand`.
const DispatchableClientOrchestrationCommand =
  BaseDispatchableClientOrchestrationCommand.mapMembers((members) => {
    const [, ...rest] = members;
    return [ProjectCreateCommand, ...rest] as const;
  });

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

// ---------------------------------------------------------------------------
// Event union: use `mapMembers` to preserve the discriminated-union tuple
// structure while swapping the `project.created` payload with the composed
// `ProjectCreatedPayload`. The `project.created` variant is the first member
// in the base union, so we replace index 0 and keep the remaining members
// verbatim — this lets TypeScript see the composed payload in narrowings.
// ---------------------------------------------------------------------------

export const OrchestrationEvent = BaseOrchestrationEvent.mapMembers((members) => {
  const [firstMember, ...restMembers] = members;
  const replacedFirst = Schema.Struct({
    ...firstMember.fields,
    payload: ProjectCreatedPayload,
  });
  return [replacedFirst, ...restMembers] as const;
});
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

// ---------------------------------------------------------------------------
// RPC schema table: rebuild so inputs/outputs use the composed types.
// ---------------------------------------------------------------------------

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
  },
} as const;
