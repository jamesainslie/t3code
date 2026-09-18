import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

it.layer(NodeServices.layer)("source-owned thread commands", (it) => {
  it.effect(
    "allows local settlement, archival, reopening, and deletion without editing imported history",
    () =>
      Effect.gen(function* () {
        const at = "2026-09-07T00:00:00Z";
        const threadId = ThreadId.make("t3sync-source-thread-version");
        const commandId = CommandId.make("lifecycle");
        let model = yield* projectEvent(createEmptyReadModel(at), {
          sequence: 1,
          eventId: EventId.make("imported-thread"),
          aggregateKind: "thread",
          aggregateId: threadId,
          type: "thread.created",
          occurredAt: at,
          commandId,
          causationEventId: null,
          correlationId: commandId,
          metadata: { historyImport: true },
          payload: {
            threadId,
            projectId: ProjectId.make("p1"),
            title: "Imported",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: at,
            updatedAt: at,
          },
        });
        const rejected = yield* decideOrchestrationCommand({
          readModel: model,
          command: { type: "thread.meta.update", commandId, threadId, title: "Overwritten" },
        }).pipe(Effect.flip);
        expect(rejected.message).toContain("Continue in fork");
        const commands: OrchestrationCommand[] = [
          { type: "thread.settle", commandId, threadId },
          { type: "thread.unsettle", commandId, threadId, reason: "user" },
          { type: "thread.archive", commandId, threadId },
          { type: "thread.unarchive", commandId, threadId },
          { type: "thread.delete", commandId, threadId },
        ];
        const observed: string[] = [];
        for (const command of commands) {
          const result = yield* decideOrchestrationCommand({ command, readModel: model });
          for (const event of Array.isArray(result) ? result : [result]) {
            observed.push(event.type);
            expect(event.metadata.historyImport).not.toBe(true);
            model = yield* projectEvent(model, { ...event, sequence: model.snapshotSequence + 1 });
          }
        }
        expect(observed).toEqual([
          "thread.settled",
          "thread.unsettled",
          "thread.archived",
          "thread.unarchived",
          "thread.deleted",
        ]);
        expect(model.threads[0]?.deletedAt).not.toBeNull();
        expect(model.threads[0]?.title).toBe("Imported");
      }),
  );

  it.effect("rejects client creation inside the reserved sync namespace", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: createEmptyReadModel("2026-09-07T00:00:00Z"),
        command: {
          type: "thread.create",
          commandId: CommandId.make("client-create"),
          threadId: ThreadId.make("t3sync-test"),
          projectId: ProjectId.make("p1"),
          title: "Attempt",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-09-07T00:00:00Z",
        },
      }).pipe(Effect.flip);
      expect(result.message).toContain("Continue in fork");
    }),
  );

  it.effect("plans one publication with history and its undo record", () =>
    Effect.gen(function* () {
      const at = "2026-09-07T00:00:00Z";
      const commandId = CommandId.make("publish-one");
      const projectId = ProjectId.make("p1");
      const events = yield* decideOrchestrationCommand({
        readModel: createEmptyReadModel(at),
        command: {
          type: "project.sync.apply",
          commandId,
          projectId,
          expectedSequence: 0,
          commands: [
            {
              type: "project.create",
              commandId,
              projectId,
              title: "Imported",
              workspaceRoot: "/work/example",
              createdAt: at,
            },
          ],
          record: {
            id: "batch-one",
            sourceId: "source-one",
            sourceHome: "/source",
            createdAt: at,
            parentId: null,
            undoBatchId: null,
            contentHash: "hash",
            mappings: [],
            visibleThreadIds: [],
            hiddenThreadIds: [],
            projectChanges: [],
          },
        },
      });
      expect(Array.isArray(events) && events.map((event) => event.type)).toEqual([
        "project.created",
        "project.sync-recorded",
      ]);
    }),
  );
});
