// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { ChatAttachment, ProjectSyncMapping } from "@t3tools/contracts";
import { attachmentRelativePath } from "../attachmentStore.ts";
import { contentHash, type SyncSource } from "./Source.ts";

/** Content-addressed copies are shared by immutable imports and their independent continuations. */
export async function copySyncAttachment(
  attachment: ChatAttachment,
  sourceDirectory: string,
  targetDirectory: string,
): Promise<ChatAttachment> {
  const relative = attachmentRelativePath(attachment);
  if (relative === null) throw new Error(`Unsupported attachment type: ${attachment.type}`);
  const root = await NodeFSP.realpath(sourceDirectory);
  const source = await NodeFSP.realpath(NodePath.join(root, relative));
  if (!source.startsWith(`${root}${NodePath.sep}`))
    throw new Error(`Attachment ${attachment.name} is outside its source directory.`);
  const bytes = await NodeFSP.readFile(source);
  if (bytes.byteLength !== attachment.sizeBytes)
    throw new Error(`Attachment ${attachment.name} changed size. Retry the sync.`);
  const id = `t3syncasset-${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}`;
  const copied = { ...attachment, id };
  await NodeFSP.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const target = NodePath.join(targetDirectory, attachmentRelativePath(copied)!);
  try {
    const existing = await NodeFSP.readFile(target);
    if (existing.equals(bytes)) return copied;
    throw new Error(`Immutable attachment ${attachment.name} failed its checksum.`);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  const temporary = `${target}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    await NodeFSP.writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    const handle = await NodeFSP.open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await NodeFSP.rename(temporary, target);
    const directory = await NodeFSP.open(targetDirectory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
  return copied;
}

export async function inspectSyncAssets(source: SyncSource): Promise<Map<string, string[]>> {
  const warnings = new Map<string, string[]>();
  for (const entry of source.projects) {
    for (const attachment of entry.threads.flatMap((thread) =>
      thread.messages.flatMap((message) => message.attachments ?? []),
    )) {
      try {
        const relative = attachmentRelativePath(attachment);
        if (relative === null) throw new Error("Unsupported attachment format");
        const root = await NodeFSP.realpath(
          NodePath.join(source.sourceHome, "userdata/attachments"),
        );
        const file = await NodeFSP.realpath(NodePath.join(root, relative));
        if (!file.startsWith(`${root}${NodePath.sep}`))
          throw new Error("Attachment is outside the source directory");
        if ((await NodeFSP.stat(file)).size !== attachment.sizeBytes)
          throw new Error("Attachment size has changed");
      } catch {
        const messages = warnings.get(entry.project.id) ?? [];
        messages.push(
          `Attachment ${attachment.name} is unavailable. Repair it in the source or skip this project.`,
        );
        warnings.set(entry.project.id, messages);
      }
    }
  }
  return warnings;
}

export async function stageSyncSource(
  source: SyncSource,
  attachmentsDirectory: string,
  mappings?: ReadonlyArray<ProjectSyncMapping>,
): Promise<SyncSource> {
  const projects: SyncSource["projects"][number][] = [];
  for (const entry of source.projects) {
    if (
      mappings &&
      !mappings.some(
        (mapping) => mapping.sourceProjectId === entry.project.id && mapping.projectId !== null,
      )
    ) {
      projects.push(entry);
      continue;
    }
    const threads: SyncSource["projects"][number]["threads"][number][] = [];
    for (const thread of entry.threads) {
      const messages = [];
      for (const message of thread.messages) {
        const attachments: ChatAttachment[] = [];
        for (const attachment of message.attachments ?? []) {
          attachments.push(
            await copySyncAttachment(
              attachment,
              NodePath.join(source.sourceHome, "userdata/attachments"),
              attachmentsDirectory,
            ),
          );
        }
        messages.push({ ...message, attachments });
      }
      threads.push({ ...thread, messages });
    }
    projects.push({ ...entry, threads });
  }
  return { ...source, projects, contentHash: contentHash(projects) };
}
