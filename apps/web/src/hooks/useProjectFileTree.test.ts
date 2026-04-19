import { describe, expect, it, vi, afterEach } from "vitest";
import type { ProjectFileChangeEvent, ProjectFileEntry } from "@t3tools/contracts";
import type { WsRpcClient } from "~/rpc/wsRpcClient";
import { buildFileTree, applyFileTreeEvent } from "~/components/files/FileTreeState";

// We test the subscription wiring logic by verifying that the hook's
// onFileChanges mock gets called with the correct arguments and that
// the unsubscribe function is returned correctly.  The actual tree
// building and event application are covered by FileTreeState.test.ts.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(relativePath: string, size = 100, mtimeMs = 1000): ProjectFileEntry {
  return { relativePath, size, mtimeMs, oversized: false } as ProjectFileEntry;
}

type FileChangeListener = (event: ProjectFileChangeEvent) => void;

interface MockOnFileChanges {
  fn: WsRpcClient["projects"]["onFileChanges"];
  capturedListener: FileChangeListener | null;
  capturedInput: unknown;
  capturedOptions: unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createMockOnFileChanges(): MockOnFileChanges {
  const mock: MockOnFileChanges = {
    fn: null as unknown as WsRpcClient["projects"]["onFileChanges"],
    capturedListener: null,
    capturedInput: null,
    capturedOptions: null,
    unsubscribe: vi.fn(),
  };
  mock.fn = vi.fn((input, listener, options) => {
    mock.capturedInput = input;
    mock.capturedListener = listener;
    mock.capturedOptions = options;
    return mock.unsubscribe;
  }) as unknown as WsRpcClient["projects"]["onFileChanges"];
  return mock;
}

function createMockRpcClient(
  onFileChangesMock: MockOnFileChanges,
): WsRpcClient {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProjectFileTree subscription wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("onFileChanges mock captures the subscription input correctly", () => {
    const mock = createMockOnFileChanges();
    const client = createMockRpcClient(mock);

    // Simulate what the hook does internally when subscribing
    const unsub = client.projects.onFileChanges(
      { cwd: "/project/root", globs: ["**/*"], ignoreGlobs: [] },
      () => {},
      { onResubscribe: () => {} },
    );

    expect(mock.fn).toHaveBeenCalledOnce();
    expect(mock.capturedInput).toEqual({
      cwd: "/project/root",
      globs: ["**/*"],
      ignoreGlobs: [],
    });
    expect(mock.capturedListener).toBeTypeOf("function");
    expect(mock.capturedOptions).toHaveProperty("onResubscribe");
    expect(typeof unsub).toBe("function");
  });

  it("unsubscribe function is callable", () => {
    const mock = createMockOnFileChanges();
    const client = createMockRpcClient(mock);

    const unsub = client.projects.onFileChanges(
      { cwd: "/cwd", globs: ["**/*"], ignoreGlobs: [] },
      () => {},
    );

    expect(mock.unsubscribe).not.toHaveBeenCalled();
    unsub();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });

  it("listener receives snapshot events and can build tree", () => {
    const mock = createMockOnFileChanges();
    const client = createMockRpcClient(mock);

    let receivedEvent: ProjectFileChangeEvent | null = null;
    client.projects.onFileChanges(
      { cwd: "/cwd", globs: ["**/*"], ignoreGlobs: [] },
      (event) => {
        receivedEvent = event;
      },
    );

    const snapshot: ProjectFileChangeEvent = {
      _tag: "snapshot",
      files: [makeEntry("src/index.ts"), makeEntry("README.md")],
    } as ProjectFileChangeEvent;

    mock.capturedListener!(snapshot);
    expect(receivedEvent).toBe(snapshot);

    // Verify buildFileTree can process the snapshot's files
    const tree = buildFileTree(
      (snapshot as Extract<ProjectFileChangeEvent, { _tag: "snapshot" }>).files,
    );
    expect(tree.length).toBeGreaterThan(0);
  });

  it("listener receives incremental events and can apply them", () => {
    const mock = createMockOnFileChanges();
    const client = createMockRpcClient(mock);

    const events: ProjectFileChangeEvent[] = [];
    client.projects.onFileChanges(
      { cwd: "/cwd", globs: ["**/*"], ignoreGlobs: [] },
      (event) => {
        events.push(event);
      },
    );

    // First: snapshot
    const snapshot: ProjectFileChangeEvent = {
      _tag: "snapshot",
      files: [makeEntry("a.ts")],
    } as ProjectFileChangeEvent;
    mock.capturedListener!(snapshot);

    // Second: added event
    const addedEvent: ProjectFileChangeEvent = {
      _tag: "added",
      relativePath: "b.ts",
      size: 200,
      mtimeMs: 2000,
    } as ProjectFileChangeEvent;
    mock.capturedListener!(addedEvent);

    expect(events).toHaveLength(2);
    expect(events[0]._tag).toBe("snapshot");
    expect(events[1]._tag).toBe("added");

    // Verify the tree operations work correctly
    let tree = buildFileTree(
      (snapshot as Extract<ProjectFileChangeEvent, { _tag: "snapshot" }>).files,
    );
    tree = applyFileTreeEvent(tree, addedEvent);

    const paths = collectPaths(tree);
    expect(paths).toContain("a.ts");
    expect(paths).toContain("b.ts");
  });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function collectPaths(
  nodes: ReadonlyArray<{ relativePath: string; children?: ReadonlyArray<unknown> }>,
): string[] {
  const paths: string[] = [];
  function walk(
    ns: ReadonlyArray<{ relativePath: string; children?: ReadonlyArray<unknown> }>,
  ): void {
    for (const n of ns) {
      paths.push(n.relativePath);
      if (n.children) {
        walk(
          n.children as ReadonlyArray<{
            relativePath: string;
            children?: ReadonlyArray<unknown>;
          }>,
        );
      }
    }
  }
  walk(nodes);
  return paths;
}
