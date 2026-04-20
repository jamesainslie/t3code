import { describe, expect, it, vi } from "vitest";

import type { ProjectFileChangeEvent } from "@t3tools/contracts";

import { FileNotFoundError, type RpcClient, T3FileAdapter } from "../FileAdapter.ts";

type Unsubscribe = () => void;
type StreamHandler<O> = (value: O) => void;

interface RecordedStream<O> {
  handler: StreamHandler<O>;
  unsubscribed: boolean;
}

const fakeRpcClient = () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const callImpl = vi.fn(async (_method: string, _input: unknown): Promise<unknown> => undefined);
  const activeStreams: Array<RecordedStream<ProjectFileChangeEvent>> = [];

  const client = {
    call: (async <I, O>(method: string, input: I): Promise<O> => {
      calls.push({ method, input });
      return (await callImpl(method, input)) as O;
    }) as RpcClient["call"],
    stream: (<_I, O>(_method: string, _input: _I, handler: (value: O) => void) => {
      const record: RecordedStream<ProjectFileChangeEvent> = {
        handler: handler as unknown as StreamHandler<ProjectFileChangeEvent>,
        unsubscribed: false,
      };
      activeStreams.push(record);
      const unsub: Unsubscribe = () => {
        record.unsubscribed = true;
      };
      return unsub;
    }) as RpcClient["stream"],
  } satisfies RpcClient;

  return { client, calls, callImpl, activeStreams };
};

describe("T3FileAdapter.readFile", () => {
  it("invokes the RPC call with cwd + relativePath and returns the file contents", async () => {
    const { client, calls, callImpl } = fakeRpcClient();
    callImpl.mockResolvedValueOnce({
      contents: "# hello",
      relativePath: "docs/a.md",
      size: 7,
      mtimeMs: 123,
    });

    const adapter = new T3FileAdapter({ client, cwd: "/repo" });

    const contents = await adapter.readFile("docs/a.md");

    expect(contents).toBe("# hello");
    expect(calls).toEqual([
      {
        method: "projects.readFile",
        input: { cwd: "/repo", relativePath: "docs/a.md" },
      },
    ]);
  });

  it("rethrows a NotFound tagged error as a typed FileNotFoundError", async () => {
    const { client, callImpl } = fakeRpcClient();
    callImpl.mockRejectedValueOnce({
      _tag: "NotFound",
      relativePath: "missing.md",
    });

    const adapter = new T3FileAdapter({ client, cwd: "/repo" });

    await expect(adapter.readFile("missing.md")).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it("rethrows non-NotFound errors untouched", async () => {
    const { client, callImpl } = fakeRpcClient();
    const original = new Error("boom");
    callImpl.mockRejectedValueOnce(original);

    const adapter = new T3FileAdapter({ client, cwd: "/repo" });

    await expect(adapter.readFile("a.md")).rejects.toBe(original);
  });
});

describe("T3FileAdapter.watch", () => {
  it("subscribes via subscribeProjectFileChanges and invokes the callback only for matching relativePath", () => {
    const { client, activeStreams } = fakeRpcClient();
    const adapter = new T3FileAdapter({ client, cwd: "/repo" });
    const cb = vi.fn();

    const unsubscribe = adapter.watch("docs/a.md", cb);

    expect(activeStreams).toHaveLength(1);
    const stream = activeStreams[0]!;

    stream.handler({
      _tag: "changed",
      relativePath: "docs/a.md",
      size: 4,
      mtimeMs: 2,
    });
    stream.handler({
      _tag: "changed",
      relativePath: "docs/other.md",
      size: 1,
      mtimeMs: 3,
    });
    stream.handler({
      _tag: "added",
      relativePath: "docs/a.md",
      size: 10,
      mtimeMs: 4,
    });
    stream.handler({
      _tag: "removed",
      relativePath: "docs/a.md",
    });

    expect(cb).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(stream.unsubscribed).toBe(true);
  });

  it("ignores snapshot events (they feed listFiles, not watch)", () => {
    const { client, activeStreams } = fakeRpcClient();
    const adapter = new T3FileAdapter({ client, cwd: "/repo" });
    const cb = vi.fn();

    adapter.watch("docs/a.md", cb);
    const stream = activeStreams[0]!;

    stream.handler({
      _tag: "snapshot",
      files: [{ relativePath: "docs/a.md", size: 2, mtimeMs: 1, oversized: false }],
    });

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("T3FileAdapter.listFiles", () => {
  it("resolves with the files from the initial snapshot event", async () => {
    const { client, activeStreams } = fakeRpcClient();
    const adapter = new T3FileAdapter({ client, cwd: "/repo" });

    const resultPromise = adapter.listFiles({ globs: ["**/*.md"] });

    // Simulate the server emitting a snapshot.
    const stream = activeStreams[0]!;
    stream.handler({
      _tag: "snapshot",
      files: [
        { relativePath: "docs/a.md", size: 2, mtimeMs: 1, oversized: false },
        { relativePath: "README.md", size: 10, mtimeMs: 2, oversized: false },
      ],
    });

    const result = await resultPromise;
    expect(result.map((f) => f.relativePath)).toEqual(["docs/a.md", "README.md"]);
    // listFiles should unsubscribe once it has the snapshot.
    expect(stream.unsubscribed).toBe(true);
  });
});

describe("T3FileAdapter.writeFile and checkChanged", () => {
  it("writes markdown content through the workspace write RPC", async () => {
    const { client, calls, callImpl } = fakeRpcClient();
    callImpl.mockResolvedValueOnce({ relativePath: "docs/a.md" });
    const adapter = new T3FileAdapter({ client, cwd: "/repo" });
    const result = await adapter.writeFile("docs/a.md", "body");
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      {
        method: "projects.writeFile",
        input: { cwd: "/repo", relativePath: "docs/a.md", contents: "body" },
      },
    ]);
  });

  it("reports write RPC failures as FileWriteResult errors", async () => {
    const { client, callImpl } = fakeRpcClient();
    callImpl.mockRejectedValueOnce(new Error("disk full"));
    const adapter = new T3FileAdapter({ client, cwd: "/repo" });
    const result = await adapter.writeFile("docs/a.md", "body");
    expect(result).toEqual({ success: false, error: "disk full" });
  });

  it("checkChanged reports unchanged without touching the RPC client", async () => {
    const { client, calls } = fakeRpcClient();
    const adapter = new T3FileAdapter({ client, cwd: "/repo" });
    const info = await adapter.checkChanged("a.md", "hash");
    expect(info.changed).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
