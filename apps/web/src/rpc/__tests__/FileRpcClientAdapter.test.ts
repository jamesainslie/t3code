import { describe, expect, it, vi } from "vitest";

import { createFileRpcClientAdapter } from "../FileRpcClientAdapter";
import type { WsRpcClient } from "../wsRpcClient";

function makeMockWsRpcClient() {
  const readFile = vi.fn<any>().mockResolvedValue({
    contents: "# Hello",
    relativePath: "docs/a.md",
    size: 7,
    mtimeMs: 100,
  });
  const updateFrontmatter = vi.fn<any>().mockResolvedValue({
    relativePath: "docs/a.md",
    success: true,
  });
  const writeFile = vi.fn<any>().mockResolvedValue({
    relativePath: "docs/a.md",
  });
  const unsubscribe = vi.fn();
  const onFileChanges = vi.fn<any>().mockReturnValue(unsubscribe);

  const client = {
    projects: {
      searchEntries: vi.fn(),
      writeFile,
      readFile,
      updateFrontmatter,
      onFileChanges,
    },
  } as unknown as WsRpcClient;

  return { client, readFile, updateFrontmatter, writeFile, onFileChanges, unsubscribe };
}

describe("createFileRpcClientAdapter", () => {
  describe("call", () => {
    it("routes projects.readFile to wsRpcClient.projects.readFile", async () => {
      const { client, readFile } = makeMockWsRpcClient();
      const adapter = createFileRpcClientAdapter(client);

      const input = { cwd: "/repo", relativePath: "docs/a.md" };
      const result = await adapter.call("projects.readFile", input);

      expect(readFile).toHaveBeenCalledOnce();
      expect(readFile).toHaveBeenCalledWith(input);
      expect(result).toEqual({
        contents: "# Hello",
        relativePath: "docs/a.md",
        size: 7,
        mtimeMs: 100,
      });
    });

    it("routes projects.updateFrontmatter to wsRpcClient.projects.updateFrontmatter", async () => {
      const { client, updateFrontmatter } = makeMockWsRpcClient();
      const adapter = createFileRpcClientAdapter(client);

      const input = {
        cwd: "/repo",
        relativePath: "docs/a.md",
        frontmatter: { title: "New Title" },
      };
      const result = await adapter.call("projects.updateFrontmatter", input);

      expect(updateFrontmatter).toHaveBeenCalledOnce();
      expect(updateFrontmatter).toHaveBeenCalledWith(input);
      expect(result).toEqual({
        relativePath: "docs/a.md",
        success: true,
      });
    });

    it("routes projects.writeFile to wsRpcClient.projects.writeFile", async () => {
      const { client, writeFile } = makeMockWsRpcClient();
      const adapter = createFileRpcClientAdapter(client);

      const input = {
        cwd: "/repo",
        relativePath: "docs/a.md",
        contents: "# Hello",
      };
      const result = await adapter.call("projects.writeFile", input);

      expect(writeFile).toHaveBeenCalledOnce();
      expect(writeFile).toHaveBeenCalledWith(input);
      expect(result).toEqual({
        relativePath: "docs/a.md",
      });
    });

    it("throws for unknown call method", async () => {
      const { client } = makeMockWsRpcClient();
      const adapter = createFileRpcClientAdapter(client);

      await expect(adapter.call("unknown.method", {})).rejects.toThrow(
        'FileRpcClientAdapter: unknown call method "unknown.method"',
      );
    });
  });

  describe("stream", () => {
    it("routes subscribeProjectFileChanges to wsRpcClient.projects.onFileChanges", () => {
      const { client, onFileChanges, unsubscribe } = makeMockWsRpcClient();
      const adapter = createFileRpcClientAdapter(client);

      const input = { cwd: "/repo", globs: ["**/*.md"], ignoreGlobs: [] };
      const handler = vi.fn();
      const unsub = adapter.stream("subscribeProjectFileChanges", input, handler);

      expect(onFileChanges).toHaveBeenCalledOnce();
      expect(onFileChanges).toHaveBeenCalledWith(input, handler);
      expect(typeof unsub).toBe("function");

      unsub();
      expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it("throws for unknown stream method", () => {
      const { client } = makeMockWsRpcClient();
      const adapter = createFileRpcClientAdapter(client);

      expect(() => adapter.stream("unknown.stream", {}, vi.fn())).toThrow(
        'FileRpcClientAdapter: unknown stream method "unknown.stream"',
      );
    });
  });
});
