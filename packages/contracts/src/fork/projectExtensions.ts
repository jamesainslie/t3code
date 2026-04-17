import { Effect, Schema } from "effect";
import { IsoDateTime } from "../baseSchemas.ts";
import { RemoteHost } from "./remoteHost.ts";

/**
 * Fork-only fields added to project-shaped structs (`OrchestrationProject`,
 * `ProjectCreateCommand`, `ProjectCreatedPayload`).
 *
 * Kept in a separate module so that upstream merges only need to rename the
 * base structs in `../orchestration.ts` without reconciling field additions.
 */
export const ProjectForkFields = {
  remoteHost: Schema.optional(RemoteHost),
} as const;

/**
 * Fork-only fields for `OrchestrationProjectShell`. Includes `remoteHost` plus
 * a `deletedAt` override that carries a decoding default of `null` (the base
 * upstream `OrchestrationProjectShell` did not declare a `deletedAt` field).
 */
export const ProjectShellForkFields = {
  remoteHost: Schema.optional(RemoteHost),
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
} as const;
