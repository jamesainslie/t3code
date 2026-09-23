import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function makeReadModel(input: {
  readonly highlightColor?: string | null;
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        highlightColor: input.highlightColor ?? null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

const decideHighlight = (color: string | null, readModel: OrchestrationReadModel) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.highlight.set",
      commandId: CommandId.make("cmd-highlight"),
      threadId: ThreadId.make("thread-1"),
      color,
    },
    readModel,
  }).pipe(Effect.map((event) => (Array.isArray(event) ? event : [event])));

it.layer(NodeServices.layer)("thread highlight decider", (it) => {
  it.effect("sets a new color, stamping updatedAt", () =>
    Effect.gen(function* () {
      const events = yield* decideHighlight("#ff8800", makeReadModel({}));
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event?.type).toBe("thread.highlighted");
      if (event?.type === "thread.highlighted") {
        expect(event.payload.color).toBe("#ff8800");
        expect(event.payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("clears the color with null", () =>
    Effect.gen(function* () {
      const events = yield* decideHighlight(null, makeReadModel({ highlightColor: "#ff8800" }));
      const event = events[0];
      expect(event?.type).toBe("thread.highlighted");
      if (event?.type === "thread.highlighted") {
        expect(event.payload.color).toBeNull();
        expect(event.payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("setting the same color preserves updatedAt", () =>
    Effect.gen(function* () {
      const events = yield* decideHighlight(
        "#ff8800",
        makeReadModel({ highlightColor: "#ff8800" }),
      );
      const event = events[0];
      expect(event?.type).toBe("thread.highlighted");
      if (event?.type === "thread.highlighted") {
        expect(event.payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("clearing an unhighlighted thread preserves updatedAt", () =>
    Effect.gen(function* () {
      const events = yield* decideHighlight(null, makeReadModel({}));
      const event = events[0];
      if (event?.type === "thread.highlighted") {
        expect(event.payload.updatedAt).toBe(NOW);
      } else {
        expect.unreachable("expected thread.highlighted");
      }
    }),
  );

  it.effect("rejects a missing thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.highlight.set",
          commandId: CommandId.make("cmd-highlight-missing"),
          threadId: ThreadId.make("thread-missing"),
          color: "#ff8800",
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("settling a thread leaves its highlight alone", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.settle",
          commandId: CommandId.make("cmd-settle"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({ highlightColor: "#ff8800" }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events.map((entry) => entry.type)).not.toContain("thread.highlighted");
    }),
  );
});
