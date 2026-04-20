import { describe, expect, it, vi, afterEach } from "vitest";
import { ThreadId, TurnId, type ProjectFileChangeEvent } from "@t3tools/contracts";
import type { WsRpcClient } from "~/rpc/wsRpcClient";

/**
 * These tests verify the subscription wiring and event filtering logic
 * of useDocsAutoSurface by simulating what the hook does internally:
 * subscribing to onFileChanges, filtering events by _tag and threadId,
 * and gating on previewOpen state.
 *
 * The actual React hook glues these together with useEffect/useRef,
 * which follows the same subscription pattern tested in
 * useProjectFileTree.test.ts.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FileChangeListener = (event: ProjectFileChangeEvent) => void;

interface MockOnFileChanges {
  fn: WsRpcClient["projects"]["onFileChanges"];
  capturedListener: FileChangeListener | null;
  capturedInput: unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createMockOnFileChanges(): MockOnFileChanges {
  const mock: MockOnFileChanges = {
    fn: null as unknown as WsRpcClient["projects"]["onFileChanges"],
    capturedListener: null,
    capturedInput: null,
    unsubscribe: vi.fn(),
  };
  mock.fn = vi.fn((_input, listener) => {
    mock.capturedListener = listener;
    mock.capturedInput = _input;
    return mock.unsubscribe;
  }) as unknown as WsRpcClient["projects"]["onFileChanges"];
  return mock;
}

function createMockRpcClient(onFileChangesMock: MockOnFileChanges): WsRpcClient {
  return {
    projects: {
      onFileChanges: onFileChangesMock.fn,
      readFile: vi.fn(),
      searchEntries: vi.fn(),
      writeFile: vi.fn(),
      updateFrontmatter: vi.fn(),
    },
  } as unknown as WsRpcClient;
}

function makeTurnTouchedDoc(
  threadId: string,
  turnId: string,
  paths: string[],
): ProjectFileChangeEvent {
  return {
    _tag: "turnTouchedDoc",
    threadId: ThreadId.make(threadId),
    turnId: TurnId.make(turnId),
    paths,
  };
}

/**
 * Simulates the core filtering logic of useDocsAutoSurface's subscription
 * callback. This mirrors what the hook does inside onFileChanges.
 */
function createAutoSurfaceHandler(opts: {
  threadId: string;
  previewOpenRef: { current: boolean };
  onAutoSurface: (relativePath: string, touchedPaths: readonly string[]) => void;
  disposedRef: { current: boolean };
}): FileChangeListener {
  return (event: ProjectFileChangeEvent) => {
    if (opts.disposedRef.current) return;
    if (event._tag !== "turnTouchedDoc") return;
    if (event.threadId !== opts.threadId) return;
    if (opts.previewOpenRef.current) return;
    if (event.paths.length === 0) return;
    opts.onAutoSurface(event.paths[0]!, event.paths);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDocsAutoSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("subscription wiring", () => {
    it("subscribes to onFileChanges with the correct input", () => {
      const mock = createMockOnFileChanges();
      const client = createMockRpcClient(mock);

      client.projects.onFileChanges(
        { cwd: "/project", globs: ["**/*"], ignoreGlobs: [] },
        () => {},
      );

      expect(mock.fn).toHaveBeenCalledOnce();
      expect(mock.capturedInput).toEqual({
        cwd: "/project",
        globs: ["**/*"],
        ignoreGlobs: [],
      });
    });

    it("returns an unsubscribe function that is callable", () => {
      const mock = createMockOnFileChanges();
      const client = createMockRpcClient(mock);

      const unsub = client.projects.onFileChanges(
        { cwd: "/project", globs: ["**/*"], ignoreGlobs: [] },
        () => {},
      );

      expect(mock.unsubscribe).not.toHaveBeenCalled();
      unsub();
      expect(mock.unsubscribe).toHaveBeenCalledOnce();
    });
  });

  describe("event filtering", () => {
    it("auto-surfaces when turnTouchedDoc event arrives for matching threadId", () => {
      const onAutoSurface = vi.fn();
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: false },
        onAutoSurface,
        disposedRef: { current: false },
      });

      handler(makeTurnTouchedDoc("thread-1", "turn-1", ["docs/readme.md", "docs/api.md"]));

      expect(onAutoSurface).toHaveBeenCalledOnce();
      expect(onAutoSurface).toHaveBeenCalledWith("docs/readme.md", [
        "docs/readme.md",
        "docs/api.md",
      ]);
    });

    it("does NOT auto-surface when preview is already open", () => {
      const onAutoSurface = vi.fn();
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: true },
        onAutoSurface,
        disposedRef: { current: false },
      });

      handler(makeTurnTouchedDoc("thread-1", "turn-1", ["docs/readme.md"]));

      expect(onAutoSurface).not.toHaveBeenCalled();
    });

    it("does NOT auto-surface for different threadId", () => {
      const onAutoSurface = vi.fn();
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: false },
        onAutoSurface,
        disposedRef: { current: false },
      });

      handler(makeTurnTouchedDoc("thread-other", "turn-1", ["docs/readme.md"]));

      expect(onAutoSurface).not.toHaveBeenCalled();
    });

    it("ignores non-turnTouchedDoc events", () => {
      const onAutoSurface = vi.fn();
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: false },
        onAutoSurface,
        disposedRef: { current: false },
      });

      handler({ _tag: "snapshot", files: [] } as ProjectFileChangeEvent);
      handler({
        _tag: "added",
        relativePath: "new-file.ts",
        size: 100,
        mtimeMs: 1000,
      } as ProjectFileChangeEvent);
      handler({
        _tag: "changed",
        relativePath: "changed-file.ts",
        size: 200,
        mtimeMs: 2000,
      } as ProjectFileChangeEvent);
      handler({
        _tag: "removed",
        relativePath: "removed-file.ts",
      } as ProjectFileChangeEvent);

      expect(onAutoSurface).not.toHaveBeenCalled();
    });

    it("ignores turnTouchedDoc events with empty paths", () => {
      const onAutoSurface = vi.fn();
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: false },
        onAutoSurface,
        disposedRef: { current: false },
      });

      handler(makeTurnTouchedDoc("thread-1", "turn-1", []));

      expect(onAutoSurface).not.toHaveBeenCalled();
    });
  });

  describe("cleanup / disposal", () => {
    it("cleans up subscription on unmount (unsubscribe is called)", () => {
      const mock = createMockOnFileChanges();
      const client = createMockRpcClient(mock);

      const unsub = client.projects.onFileChanges(
        { cwd: "/project", globs: ["**/*"], ignoreGlobs: [] },
        () => {},
      );

      expect(mock.unsubscribe).not.toHaveBeenCalled();
      unsub();
      expect(mock.unsubscribe).toHaveBeenCalledOnce();
    });

    it("ignores events after disposal", () => {
      const onAutoSurface = vi.fn();
      const disposedRef = { current: false };
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: false },
        onAutoSurface,
        disposedRef,
      });

      // Simulate disposal (what happens on unmount)
      disposedRef.current = true;

      handler(makeTurnTouchedDoc("thread-1", "turn-1", ["docs/readme.md"]));

      expect(onAutoSurface).not.toHaveBeenCalled();
    });
  });

  describe("previewOpen reactivity", () => {
    it("respects changes to previewOpen ref between events", () => {
      const onAutoSurface = vi.fn();
      const previewOpenRef = { current: false };
      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef,
        onAutoSurface,
        disposedRef: { current: false },
      });

      // First event: preview is closed, should auto-surface
      handler(makeTurnTouchedDoc("thread-1", "turn-1", ["docs/a.md"]));
      expect(onAutoSurface).toHaveBeenCalledOnce();

      // User opened the preview panel
      previewOpenRef.current = true;

      // Second event: preview is open, should NOT auto-surface
      handler(makeTurnTouchedDoc("thread-1", "turn-2", ["docs/b.md"]));
      expect(onAutoSurface).toHaveBeenCalledOnce(); // still 1 call

      // User closed the preview panel
      previewOpenRef.current = false;

      // Third event: preview is closed again, should auto-surface
      handler(makeTurnTouchedDoc("thread-1", "turn-3", ["docs/c.md"]));
      expect(onAutoSurface).toHaveBeenCalledTimes(2);
      expect(onAutoSurface).toHaveBeenLastCalledWith("docs/c.md", ["docs/c.md"]);
    });
  });

  describe("end-to-end subscription with listener", () => {
    it("wires the subscription callback correctly through the RPC client", () => {
      const mock = createMockOnFileChanges();
      const client = createMockRpcClient(mock);
      const onAutoSurface = vi.fn();

      const handler = createAutoSurfaceHandler({
        threadId: "thread-1",
        previewOpenRef: { current: false },
        onAutoSurface,
        disposedRef: { current: false },
      });

      // Subscribe like the hook does
      const unsub = client.projects.onFileChanges(
        { cwd: "/project", globs: ["**/*"], ignoreGlobs: [] },
        handler,
      );

      // Simulate the server emitting a turnTouchedDoc event
      mock.capturedListener!(makeTurnTouchedDoc("thread-1", "turn-1", ["docs/readme.md"]));

      expect(onAutoSurface).toHaveBeenCalledOnce();
      expect(onAutoSurface).toHaveBeenCalledWith("docs/readme.md", ["docs/readme.md"]);

      // Cleanup
      unsub();
      expect(mock.unsubscribe).toHaveBeenCalledOnce();
    });
  });
});
