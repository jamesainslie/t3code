import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  OrchestrationProject,
  OrchestrationProjectShell,
  ProjectCreateCommand,
  ProjectCreatedPayload,
} from "./orchestration.ts";

const decodeProject = Schema.decodeUnknownEffect(OrchestrationProject);
const encodeProject = Schema.encodeUnknownEffect(OrchestrationProject);
const decodeProjectShell = Schema.decodeUnknownEffect(OrchestrationProjectShell);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);

it.effect("OrchestrationProject round-trips a value that carries remoteHost", () =>
  Effect.gen(function* () {
    const input = {
      id: "project-remote-1",
      title: "Remote Project",
      workspaceRoot: "/srv/remote",
      repositoryIdentity: null,
      remoteHost: {
        host: "remote.example.com",
        user: "deployer",
        port: 2222,
        label: "prod-node",
      },
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    };

    const decoded = yield* decodeProject(input);
    assert.deepEqual(decoded.remoteHost, {
      host: "remote.example.com",
      user: "deployer",
      port: 2222,
      label: "prod-node",
    });

    const encoded = yield* encodeProject(decoded);
    const redecoded = yield* decodeProject(encoded);
    assert.deepEqual(redecoded.remoteHost, decoded.remoteHost);
  }),
);

it.effect("OrchestrationProject decodes cleanly without remoteHost", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeProject({
      id: "project-local-1",
      title: "Local Project",
      workspaceRoot: "/home/dev/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    });

    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(decoded, "remoteHost"),
      false,
      "remoteHost must stay absent when not provided in the input",
    );
    assert.strictEqual(decoded.id, "project-local-1");
  }),
);

it.effect("OrchestrationProject remoteHost port defaults to 22 when omitted", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeProject({
      id: "project-remote-default-port",
      title: "Remote Project",
      workspaceRoot: "/srv/remote",
      remoteHost: {
        host: "remote.example.com",
        user: "deployer",
      },
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    });

    assert.strictEqual(decoded.remoteHost?.host, "remote.example.com");
    assert.strictEqual(decoded.remoteHost?.user, "deployer");
    assert.strictEqual(decoded.remoteHost?.port, 22);
  }),
);

it.effect("OrchestrationProjectShell defaults deletedAt to null when omitted", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeProjectShell({
      id: "project-shell-1",
      title: "Shell Project",
      workspaceRoot: "/srv/shell",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(decoded.deletedAt, null);
  }),
);

it.effect("OrchestrationProjectShell round-trips a value with remoteHost", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeProjectShell({
      id: "project-shell-remote-1",
      title: "Remote Shell",
      workspaceRoot: "/srv/shell",
      remoteHost: {
        host: "remote.example.com",
        user: "ops",
        port: 2022,
      },
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: "2026-02-01T00:00:00.000Z",
    });

    assert.strictEqual(decoded.remoteHost?.host, "remote.example.com");
    assert.strictEqual(decoded.remoteHost?.port, 2022);
    assert.strictEqual(decoded.deletedAt, "2026-02-01T00:00:00.000Z");
  }),
);

it.effect("ProjectCreateCommand accepts the fork remoteHost field", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-create-1",
      projectId: "project-create-1",
      title: "New Project",
      workspaceRoot: "/srv/new",
      remoteHost: {
        host: "host.example.com",
        user: "cicd",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(decoded.remoteHost?.host, "host.example.com");
    assert.strictEqual(decoded.remoteHost?.port, 22);
  }),
);

it.effect("ProjectCreatedPayload carries remoteHost through decode", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeProjectCreatedPayload({
      projectId: "project-created-1",
      title: "New Project",
      workspaceRoot: "/srv/new",
      remoteHost: {
        host: "host.example.com",
        user: "cicd",
        label: "ci-runner",
      },
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(decoded.remoteHost?.host, "host.example.com");
    assert.strictEqual(decoded.remoteHost?.label, "ci-runner");
  }),
);
