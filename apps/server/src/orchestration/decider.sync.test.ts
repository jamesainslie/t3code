import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { CommandId, ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";

it.layer(NodeServices.layer)("source-owned thread commands", (it) => {
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
