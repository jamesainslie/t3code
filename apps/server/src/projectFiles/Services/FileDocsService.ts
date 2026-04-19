/**
 * FileDocsService - Effect service contract for docs-browser file operations.
 *
 * Backs three WS RPCs:
 * - projectsReadFile (one-shot read)
 * - subscribeProjectFileChanges (stream of file-system events)
 * - projectsUpdateFrontmatter (one-shot atomic frontmatter write)
 *
 * Plus two internal hooks used by the orchestration runtime:
 * - recordTurnWrite (mark a file as written during a turn)
 * - flushTurnWrites (emit a turnTouchedDoc event for recorded paths)
 *
 * @module FileDocsService
 */
import { Context } from "effect";
import type { Effect, Stream } from "effect";
import type {
  ProjectFileChangeEvent,
  ProjectFileMonitorError,
  ProjectFileWatchInput,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectUpdateFrontmatterError,
  ProjectUpdateFrontmatterInput,
  ProjectUpdateFrontmatterResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

/**
 * Maximum file size (bytes) the docs browser will read or stream events for.
 */
export const FILE_DOCS_SIZE_CAP_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Window (milliseconds) during which file-system events for our own writes are
 * suppressed on active watch subscriptions.
 */
export const FILE_DOCS_SELF_ECHO_WINDOW_MS = 500;

/**
 * Debounce interval (milliseconds) applied per path to coalesce rapid writes
 * into a single `changed` event.
 */
export const FILE_DOCS_DEBOUNCE_INTERVAL_MS = 150;

export interface TurnWriteRecord {
  readonly cwd: string;
  readonly relativePath: string;
}

export interface FlushTurnWritesInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly cwd: string;
}

/**
 * FileDocsServiceShape - Service API for docs-browser file operations.
 */
export interface FileDocsServiceShape {
  /**
   * Read the contents of a markdown file under the workspace root.
   */
  readonly readFile: (
    input: ProjectReadFileInput,
  ) => Effect.Effect<ProjectReadFileResult, ProjectReadFileError>;

  /**
   * Subscribe to project file changes. First event is always a snapshot of
   * currently matching files, followed by per-file `added`/`changed`/`removed`
   * events and `turnTouchedDoc` notifications.
   */
  readonly watch: (
    input: ProjectFileWatchInput,
  ) => Stream.Stream<ProjectFileChangeEvent, ProjectFileMonitorError>;

  /**
   * Atomically replace the `comments` key in a file's YAML frontmatter block,
   * preserving all other keys and the body byte-for-byte.
   */
  readonly updateFrontmatter: (
    input: ProjectUpdateFrontmatterInput,
  ) => Effect.Effect<ProjectUpdateFrontmatterResult, ProjectUpdateFrontmatterError>;

  /**
   * Record a markdown file write performed during a turn. Buffered by cwd
   * until the owning turn completes and `flushTurnWrites` drains the bucket.
   *
   * Called from the `projectsWriteFile` RPC handler whenever the written
   * path has a `.md` or `.markdown` extension.
   */
  readonly recordTurnWrite: (record: TurnWriteRecord) => Effect.Effect<void>;

  /**
   * Drain the turn write buffer for the given `cwd` and publish a
   * `turnTouchedDoc` event (tagged with the given thread/turn) to that
   * cwd's watch subscription, if any.
   *
   * Called from the turn-completion site in the orchestration runtime.
   */
  readonly flushTurnWrites: (input: FlushTurnWritesInput) => Effect.Effect<void>;
}

/**
 * FileDocsService - Service tag for docs-browser file operations.
 */
export class FileDocsService extends Context.Service<FileDocsService, FileDocsServiceShape>()(
  "t3/projectFiles/Services/FileDocsService",
) {}
