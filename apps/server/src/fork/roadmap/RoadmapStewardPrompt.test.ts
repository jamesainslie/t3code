import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  RoadmapItemId,
  type RoadmapStoredEvent,
  type RoadmapWorkItem,
} from "@lathe/contracts";

import {
  assistantMessage,
  atIso,
  makeThread,
  run,
  runId,
  THREAD_ID,
  userMessage,
} from "../../mcp/toolkits/threadHistory/testFixtures.ts";
import {
  buildStewardPrompt,
  criterionUntickTimes,
  stewardCommands,
  stewardDigest,
  type StewardFindings,
  stewardNewTurns,
} from "./RoadmapStewardPrompt.ts";

const itemId = RoadmapItemId.make("feature-1");
const item = (overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: itemId,
  type: "feature",
  title: "Export reports as CSV",
  description: "Users download any report as CSV.",
  parentId: null,
  sortKey: "n",
  state: "in-progress",
  priority: null,
  area: "work",
  dueDate: null,
  startDate: null,
  estimate: null,
  criteria: [
    { id: "c1", text: "CSV export button", tickedAt: null, tickedBy: null, evidence: null },
    { id: "c2", text: "Tests cover export", tickedAt: null, tickedBy: null, evidence: null },
    {
      id: "c3",
      text: "Docs updated",
      tickedAt: "2026-09-01T00:00:00.000Z",
      tickedBy: { _tag: "user" },
      evidence: null,
    },
  ],
  blockedBy: [],
  externalBlockers: [],
  related: [],
  attachments: [],
  origin: null,
  needsReview: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  createdBy: { _tag: "user" },
  stateChangedAt: "2026-08-01T00:00:00.000Z",
  completedAt: null,
  pinnedAt: null,
  focusedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  source: null,
  pullRequests: [],
  ...overrides,
});

// Three runs: two finished (ending at 150s and 250s), one still running.
const thread = makeThread({
  runs: [
    run({ id: runId("r1"), ordinal: 1, userMessageId: "u1" }),
    run({ id: runId("r2"), ordinal: 2, userMessageId: "u2" }),
    run({ id: runId("r3"), ordinal: 3, userMessageId: "u3", status: "running" }),
  ],
  messages: [
    userMessage("u1", 100, "Add a CSV export button"),
    assistantMessage("a1", 140, runId("r1"), "Added the button."),
    userMessage("u2", 200, "Now write tests"),
    assistantMessage("a2", 240, runId("r2"), "vp test run export.test.ts: 6 passed."),
    userMessage("u3", 300, "And the docs"),
  ],
});

describe("stewardNewTurns", () => {
  it("lists finished turns that ended after the last run, never running ones", () => {
    assert.deepEqual(stewardNewTurns(thread, null), [
      { n: 1, endedAt: atIso(150) },
      { n: 2, endedAt: atIso(250) },
    ]);
    assert.deepEqual(stewardNewTurns(thread, atIso(150)), [{ n: 2, endedAt: atIso(250) }]);
    assert.deepEqual(stewardNewTurns(thread, atIso(250)), []);
  });
});

describe("criterionUntickTimes", () => {
  const ticked = (sequence: number, criterionId: string, value: boolean, at: string) =>
    ({
      sequence,
      commandId: CommandId.make(`cmd-${sequence}`),
      event: {
        type: "roadmap.criterion.ticked",
        eventId: EventId.make(`event-${sequence}`),
        itemId,
        actor: { _tag: "user" },
        occurredAt: at,
        payload: { criterionId, ticked: value, evidence: null },
      },
    }) satisfies RoadmapStoredEvent;

  it("keeps the newest untick per criterion and ignores ticks", () => {
    const times = criterionUntickTimes([
      ticked(1, "c1", false, "2026-10-01T00:00:00.000Z"),
      ticked(2, "c1", true, "2026-10-02T00:00:00.000Z"),
      ticked(3, "c1", false, "2026-10-03T00:00:00.000Z"),
      ticked(4, "c2", true, "2026-10-04T00:00:00.000Z"),
    ]);
    assert.deepEqual([...times], [["c1", "2026-10-03T00:00:00.000Z"]]);
  });
});

describe("buildStewardPrompt", () => {
  const prompt = buildStewardPrompt({
    item: item({
      progressNotes: [
        {
          id: "n1",
          at: "2026-10-01T00:00:00.000Z",
          actor: { _tag: "steward", environmentId: EnvironmentId.make("env") },
          kind: "unsure",
          text: "Button exists but no test yet.",
          criterionId: "c1",
        },
      ],
    }),
    untickedAt: new Map([["c2", "2026-10-03T00:00:00.000Z"]]),
    newTurns: [{ n: 2, endedAt: atIso(250) }],
    digest: stewardDigest({ thread, projectTitle: "Reports", newTurns: 1 }),
  });

  it("demands concrete evidence from a named new turn", () => {
    assert.include(prompt, "concrete evidence");
    assert.include(prompt, "a commit, a test or build result, or command output");
    assert.include(prompt, "Each tick names one new turn in `turn`");
    assert.include(
      prompt,
      "New turns since your last look: turn 2 (ended 2026-09-01T00:04:10.000Z).",
    );
  });

  it("asks for an unsure note when the evidence is partial", () => {
    assert.include(prompt, "partial or unclear, do not tick it. Add an `unsure` note");
  });

  it("shows each criterion's state, with the untick time the re-tick rule needs", () => {
    assert.include(prompt, "- [c1] (open) CSV export button");
    assert.include(
      prompt,
      "- [c2] (open, unticked by the user at 2026-10-03T00:00:00.000Z: tick it only for a turn that ended after that) Tests cover export",
    );
    assert.include(prompt, "- [c3] (ticked, leave it alone) Docs updated");
  });

  it("carries the item, its recent notes and the thread digest", () => {
    assert.include(prompt, "Work item: Export reports as CSV");
    assert.include(prompt, "Users download any report as CSV.");
    assert.include(prompt, "- unsure: Button exists but no test yet.");
    assert.include(prompt, "vp test run export.test.ts: 6 passed.");
    assert.include(prompt, `<thread id="${THREAD_ID}"`);
  });
});

describe("stewardCommands", () => {
  const newTurns = [{ n: 2, endedAt: atIso(250) }];
  const commandsFor = (findings: StewardFindings) =>
    stewardCommands({
      findings,
      item: item(),
      threadId: THREAD_ID,
      threadTitle: "CSV export",
      newTurns,
      runKey: atIso(250),
    });

  it("turns a tick into a command citing the turn, with the turn's end as evidenceAfter", () => {
    const [command] = commandsFor({
      ticks: [{ criterionId: "c2", turn: 2, evidence: "export.test.ts passed 6 tests" }],
      notes: [],
    });
    assert.deepEqual(command, {
      type: "roadmap.criterion.tick",
      commandId: CommandId.make(`steward:tick:${THREAD_ID}:${atIso(250)}:c2`),
      itemId,
      criterionId: "c2",
      ticked: true,
      evidence: 'Turn 2 of "CSV export": export.test.ts passed 6 tests',
      evidenceAfter: atIso(250),
    });
  });

  it("drops ticks on old turns, unknown or ticked criteria, without evidence, or repeated", () => {
    const commands = commandsFor({
      ticks: [
        { criterionId: "c1", turn: 1, evidence: "turn 1 is not new" },
        { criterionId: "c9", turn: 2, evidence: "no such criterion" },
        { criterionId: "c3", turn: 2, evidence: "already ticked" },
        { criterionId: "c1", turn: 2, evidence: "  " },
        { criterionId: "c2", turn: 2, evidence: "first" },
        { criterionId: "c2", turn: 2, evidence: "second" },
      ],
      notes: [],
    });
    assert.deepEqual(
      commands.map((command) =>
        command.type === "roadmap.criterion.tick" ? command.evidence : "",
      ),
      ['Turn 2 of "CSV export": first'],
    );
  });

  it("adds notes with stable ids, keeps a few, and unlinks a criterion that is gone", () => {
    const commands = commandsFor({
      ticks: [],
      notes: [
        {
          kind: "unsure",
          text: "A button exists but nothing shows a download.",
          criterionId: "c1",
        },
        { kind: "drift", text: "Turn 2 refactors auth, not export.", criterionId: "c9" },
        { kind: "progress", text: "   ", criterionId: null },
        { kind: "progress", text: "Tests added.", criterionId: null },
        { kind: "progress", text: "Four.", criterionId: null },
        { kind: "progress", text: "Five.", criterionId: null },
      ],
    });
    assert.deepEqual(
      commands.map((command) =>
        command.type === "roadmap.note.add"
          ? [command.noteId, command.kind, command.text, command.criterionId]
          : [],
      ),
      [
        [
          `steward:${THREAD_ID}:${atIso(250)}:0`,
          "unsure",
          "A button exists but nothing shows a download.",
          "c1",
        ],
        [
          `steward:${THREAD_ID}:${atIso(250)}:1`,
          "drift",
          "Turn 2 refactors auth, not export.",
          null,
        ],
        [`steward:${THREAD_ID}:${atIso(250)}:2`, "progress", "Tests added.", null],
        [`steward:${THREAD_ID}:${atIso(250)}:3`, "progress", "Four.", null],
      ],
    );
  });
});
