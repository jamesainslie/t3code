import { Effect, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";

export const RemoteHost = Schema.Struct({
  host: TrimmedNonEmptyString,
  user: TrimmedNonEmptyString,
  port: Schema.optional(PositiveInt).pipe(Schema.withDecodingDefault(Effect.succeed(22))),
  label: Schema.optional(TrimmedString),
});
export type RemoteHost = typeof RemoteHost.Type;
