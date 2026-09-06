import * as Schema from "effect/Schema";

/**
 * Failure of one relay step. `detail` is safe to show and log: it never
 * carries an authorization URL, a return URL, a code, or a token. Callers
 * that own a richer error type map this onto it at their boundary.
 */
export class AuthRelayError extends Schema.TaggedErrorClass<AuthRelayError>()("AuthRelayError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
