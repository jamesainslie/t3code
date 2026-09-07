// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { copySyncAttachment } from "./Assets.ts";

it("copies an attachment into immutable storage and refuses missing or escaping files", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-assets-"));
  try {
    const source = NodePath.join(root, "source");
    const target = NodePath.join(root, "target");
    await NodeFSP.mkdir(source);
    await NodeFSP.writeFile(NodePath.join(source, "original.txt"), "notes");
    const attachment = {
      type: "file" as const,
      id: "original",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
    };
    const copied = await copySyncAttachment(attachment, source, target);
    expect(copied.id).not.toBe(attachment.id);
    expect(await NodeFSP.readFile(NodePath.join(target, `${copied.id}.txt`), "utf8")).toBe("notes");
    expect((await copySyncAttachment(attachment, source, target)).id).toBe(copied.id);
    await NodeFSP.unlink(NodePath.join(source, "original.txt"));
    await expect(copySyncAttachment(attachment, source, target)).rejects.toThrow();
    await NodeFSP.writeFile(NodePath.join(root, "outside.txt"), "notes");
    await NodeFSP.symlink(
      NodePath.join(root, "outside.txt"),
      NodePath.join(source, "original.txt"),
    );
    await expect(copySyncAttachment(attachment, source, target)).rejects.toThrow("outside");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
