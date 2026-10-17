import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { LATHE_PROJECT_FILE_NAME, type LatheProjectFile } from "@lathe/contracts";
import { LatheProjectFileFromJson } from "@lathe/shared/latheProjectFile";

const decodeLatheProjectFileJson = Schema.decodeEffect(LatheProjectFileFromJson);

export class LatheProjectFileLoadError extends Schema.TaggedError<LatheProjectFileLoadError>()(
  "LatheProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${LATHE_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

export class LatheProjectFileLoader extends Context.Service<
  LatheProjectFileLoader,
  {
    /**
     * Never fails: missing, unreadable, or invalid files resolve to `Option.none` (invalid files
     * are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<LatheProjectFile>>;
  }
>()("lathe/project/LatheProjectFileLoader") {}

const logLatheProjectFileLoadError = (error: LatheProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: LatheProjectFileLoader["Service"]["load"] = Effect.fn("LatheProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, LATHE_PROJECT_FILE_NAME);
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.asSome,
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logLatheProjectFileLoadError(
                  new LatheProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<LatheProjectFile>();
      }
      return yield* decodeLatheProjectFileJson(raw.value).pipe(
        Effect.asSome,
        Effect.catchTags({
          SchemaError: (error) =>
            logLatheProjectFileLoadError(
              new LatheProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<LatheProjectFile>())),
        }),
      );
    },
  );

  return LatheProjectFileLoader.of({ load });
});

export const layer = Layer.effect(LatheProjectFileLoader, make);
