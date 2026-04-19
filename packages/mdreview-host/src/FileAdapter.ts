import type {
  FileAdapter as CoreFileAdapter,
  FileChangeInfo,
  FileWriteResult,
} from "@mdreview/core";

import type {
  ProjectFileChangeEvent,
  ProjectFileEntry,
  ProjectFileWatchInput,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
} from "@t3tools/contracts";

/**
 * Minimal RPC client surface used by {@link T3FileAdapter}. The real
 * implementation wraps an `@effect/rpc` client or a websocket bridge; tests
 * provide an in-memory fake. Kept intentionally generic so the adapter isn't
 * bound to any concrete transport.
 */
export interface RpcClient {
  /**
   * Invoke a unary RPC method. Resolves with the decoded success value; rejects
   * with either a raw JS error or a tagged RPC error (e.g. `{ _tag: "NotFound",
   * relativePath }`).
   */
  call: <I = unknown, O = unknown>(method: string, input: I) => Promise<O>;
  /**
   * Subscribe to a server stream. Returns an unsubscribe function. The handler
   * is invoked with each decoded event as it arrives.
   */
  stream: <I = unknown, O = unknown>(
    method: string,
    input: I,
    handler: (event: O) => void,
  ) => () => void;
}

/**
 * Emitted to an mdview file-change callback when the server reports a change
 * to the watched path. Only `changed`, `added`, and `removed` tags are
 * forwarded; `snapshot` and `turnTouchedDoc` events are consumed internally.
 */
export type WatchEmittedEvent = Extract<
  ProjectFileChangeEvent,
  { _tag: "changed" | "added" | "removed" }
>;

/** Thrown from {@link T3FileAdapter.readFile} when the server reports NotFound. */
export class FileNotFoundError extends Error {
  readonly _tag = "FileNotFoundError" as const;
  readonly relativePath: string;

  constructor(relativePath: string) {
    super(`File not found: ${relativePath}`);
    this.name = "FileNotFoundError";
    this.relativePath = relativePath;
  }
}

const WS_METHOD_READ_FILE = "projects.readFile";
const WS_METHOD_WATCH = "subscribeProjectFileChanges";

const isNotFoundError = (
  err: unknown,
): err is Extract<ProjectReadFileError, { _tag: "NotFound" }> =>
  typeof err === "object" &&
  err !== null &&
  "_tag" in err &&
  (err as { _tag: unknown })._tag === "NotFound";

export interface T3FileAdapterOptions {
  readonly client: RpcClient;
  readonly cwd: string;
  /**
   * Default glob set applied by {@link T3FileAdapter.watch} when it opens a
   * snapshot stream. Defaults to `["**\/*.md"]`.
   */
  readonly defaultWatchGlobs?: readonly string[];
}

export interface ListFilesInput {
  readonly globs: readonly string[];
  readonly ignoreGlobs?: readonly string[];
}

/**
 * t3code-native implementation of `@mdreview/core`'s {@link CoreFileAdapter}.
 *
 * Writes are not supported: mdview never writes through this adapter in the
 * t3code host (frontmatter updates route through a dedicated RPC). `watch()`
 * subscribes to the project file-change stream and filters events down to the
 * requested relative path before invoking the callback.
 */
export class T3FileAdapter implements CoreFileAdapter {
  private readonly client: RpcClient;
  private readonly cwd: string;
  private readonly defaultGlobs: readonly string[];

  constructor(options: T3FileAdapterOptions) {
    this.client = options.client;
    this.cwd = options.cwd;
    this.defaultGlobs = options.defaultWatchGlobs ?? ["**/*.md"];
  }

  async readFile(relativePath: string): Promise<string> {
    const input: ProjectReadFileInput = {
      cwd: this.cwd,
      relativePath,
    };
    try {
      const result = await this.client.call<
        ProjectReadFileInput,
        ProjectReadFileResult
      >(WS_METHOD_READ_FILE, input);
      return result.contents;
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new FileNotFoundError(err.relativePath);
      }
      throw err;
    }
  }

  async writeFile(
    _path: string,
    _content: string,
  ): Promise<FileWriteResult> {
    return {
      success: false,
      error:
        "writeFile not supported on T3FileAdapter; use the dedicated frontmatter RPC",
    };
  }

  async checkChanged(
    _url: string,
    _lastHash: string,
  ): Promise<FileChangeInfo> {
    // t3code uses the push-based watch stream instead of pull-based hashing.
    return { changed: false };
  }

  watch(relativePath: string, callback: () => void): () => void {
    const input: ProjectFileWatchInput = {
      cwd: this.cwd,
      globs: this.defaultGlobs,
      ignoreGlobs: [],
    };
    const unsubscribe = this.client.stream<
      ProjectFileWatchInput,
      ProjectFileChangeEvent
    >(WS_METHOD_WATCH, input, (event) => {
      if (
        (event._tag === "changed" ||
          event._tag === "added" ||
          event._tag === "removed") &&
        event.relativePath === relativePath
      ) {
        callback();
      }
    });
    return unsubscribe;
  }

  /**
   * Resolves with the `snapshot` file list emitted when the server opens the
   * watch stream. Unsubscribes once the snapshot arrives — snapshots are the
   * initial event and no further snapshots are expected in the same stream.
   */
  listFiles(input: ListFilesInput): Promise<readonly ProjectFileEntry[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;

      const watchInput: ProjectFileWatchInput = {
        cwd: this.cwd,
        globs: input.globs,
        ignoreGlobs: input.ignoreGlobs ?? [],
      };

      try {
        unsubscribe = this.client.stream<
          ProjectFileWatchInput,
          ProjectFileChangeEvent
        >(WS_METHOD_WATCH, watchInput, (event) => {
          if (settled) {
            return;
          }
          if (event._tag === "snapshot") {
            settled = true;
            const files = event.files;
            try {
              unsubscribe?.();
            } catch {
              // ignore unsubscribe errors — we already have the snapshot
            }
            resolve(files);
          }
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
