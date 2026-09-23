import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  ProjectId,
  VcsProcessExitError,
  type RepositoryIdentity,
  type ServerSettings,
} from "@t3tools/contracts";

import {
  ProjectionProjectRepository,
  type ProjectionProject,
} from "../persistence/Services/ProjectionProjects.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../persistence/Services/ProjectionThreads.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubAccountSelector from "./GitHubAccountSelector.ts";

const PROJECT_ID = ProjectId.make("project-work");

const identity = (input: {
  readonly rootPath: string;
  readonly owner: string;
  readonly provider?: string;
  readonly host?: string;
}): RepositoryIdentity => ({
  canonicalKey: `${input.host ?? "github.com"}/${input.owner}/repo`,
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: `git@${input.host ?? "github.com"}:${input.owner}/repo.git`,
  },
  rootPath: input.rootPath,
  provider: input.provider ?? "github",
  owner: input.owner,
  name: "repo",
});

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeSelector(input: {
  readonly identities: Readonly<Record<string, RepositoryIdentity>>;
  readonly settings?: Partial<
    Pick<ServerSettings, "gitHubAccountRules" | "projectSettingsOverrides">
  >;
  readonly projects?: ReadonlyArray<Pick<ProjectionProject, "projectId" | "workspaceRoot">>;
  readonly threads?: ReadonlyArray<Pick<ProjectionThread, "projectId" | "worktreePath">>;
  readonly token?: (
    args: ReadonlyArray<string>,
  ) => Effect.Effect<VcsProcess.VcsProcessOutput, VcsProcessExitError>;
  readonly commands?: Array<ReadonlyArray<string>>;
}) {
  return GitHubAccountSelector.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
          resolve: (cwd) => Effect.succeed(input.identities[cwd] ?? null),
        }),
        ServerSettingsService.layerTest({
          gitHubAccountRules: input.settings?.gitHubAccountRules ?? [],
          projectSettingsOverrides: input.settings?.projectSettingsOverrides ?? {},
        }),
        Layer.mock(ProjectionProjectRepository)({
          listAll: () =>
            Effect.succeed((input.projects ?? []) as unknown as ReadonlyArray<ProjectionProject>),
        }),
        Layer.mock(ProjectionThreadRepository)({
          listByProjectId: ({ projectId }) =>
            Effect.succeed(
              (input.threads ?? []).filter(
                (thread) => thread.projectId === projectId,
              ) as unknown as ReadonlyArray<ProjectionThread>,
            ),
        }),
        Layer.mock(VcsProcess.VcsProcess)({
          run: (command) => {
            input.commands?.push(command.args);
            return input.token?.(command.args) ?? Effect.succeed(processOutput("token-work\n"));
          },
        }),
      ),
    ),
  );
}

const workRule = { host: "github.com", owner: "geico-*", login: "work" };

it.effect("selects the account of the first matching rule", () =>
  Effect.gen(function* () {
    const selector = yield* makeSelector({
      identities: { "/repo": identity({ rootPath: "/repo", owner: "geico-private" }) },
      settings: { gitHubAccountRules: [workRule] },
    });
    assert.deepStrictEqual(yield* selector.forCheckout({ cwd: "/repo" }), {
      host: "github.com",
      login: "work",
    });
  }),
);

it.effect("lets a project override win when the project id is given", () =>
  Effect.gen(function* () {
    const selector = yield* makeSelector({
      identities: { "/repo": identity({ rootPath: "/repo", owner: "geico-private" }) },
      settings: {
        gitHubAccountRules: [workRule],
        projectSettingsOverrides: { [PROJECT_ID]: { gitHubAccount: "personal" } },
      },
    });
    assert.deepStrictEqual(yield* selector.forCheckout({ cwd: "/repo", projectId: PROJECT_ID }), {
      host: "github.com",
      login: "personal",
    });
  }),
);

it.effect("derives the project from the shell snapshot when no project id is given", () =>
  Effect.gen(function* () {
    const selector = yield* makeSelector({
      identities: {
        "/repo/src": identity({ rootPath: "/repo", owner: "geico-private" }),
        "/worktrees/feature": identity({ rootPath: "/worktrees/feature", owner: "geico-private" }),
      },
      settings: {
        gitHubAccountRules: [workRule],
        projectSettingsOverrides: { [PROJECT_ID]: { gitHubAccount: "personal" } },
      },
      projects: [{ projectId: PROJECT_ID, workspaceRoot: "/repo" }],
      threads: [{ projectId: PROJECT_ID, worktreePath: "/worktrees/feature" }],
    });
    assert.deepStrictEqual(yield* selector.forCheckout({ cwd: "/repo/src" }), {
      host: "github.com",
      login: "personal",
    });
    assert.deepStrictEqual(yield* selector.forCheckout({ cwd: "/worktrees/feature" }), {
      host: "github.com",
      login: "personal",
    });
  }),
);

it.effect("returns null for non-GitHub identities, unknown checkouts, and unmatched owners", () =>
  Effect.gen(function* () {
    const selector = yield* makeSelector({
      identities: {
        "/gitlab": identity({ rootPath: "/gitlab", owner: "geico-private", provider: "gitlab" }),
        "/other": identity({ rootPath: "/other", owner: "pingdotgg" }),
        "/enterprise": identity({
          rootPath: "/enterprise",
          owner: "geico-private",
          host: "github.geico.net",
        }),
      },
      settings: { gitHubAccountRules: [workRule] },
    });
    assert.isNull(yield* selector.forCheckout({ cwd: "/gitlab" }));
    assert.isNull(yield* selector.forCheckout({ cwd: "/other" }));
    assert.isNull(yield* selector.forCheckout({ cwd: "/enterprise" }));
    assert.isNull(yield* selector.forCheckout({ cwd: "/nowhere" }));
    assert.isNull(yield* selector.pinFor({ cwd: "/other" }));
  }),
);

it.effect("pins the selected account's token once per account within the cache lifetime", () =>
  Effect.gen(function* () {
    const commands: Array<ReadonlyArray<string>> = [];
    const selector = yield* makeSelector({
      identities: {
        "/repo": identity({ rootPath: "/repo", owner: "geico-private" }),
        "/sibling": identity({ rootPath: "/sibling", owner: "geico-sandbox" }),
      },
      settings: { gitHubAccountRules: [workRule] },
      commands,
    });
    const first = yield* selector.pinFor({ cwd: "/repo" });
    const second = yield* selector.pinFor({ cwd: "/sibling" });
    assert.isNotNull(first);
    assert.strictEqual(first, second);
    assert.deepStrictEqual(commands, [
      ["auth", "token", "--hostname", "github.com", "--user", "work"],
    ]);
    assert.strictEqual(first!.scope, "checkout");
    assert.strictEqual(first!.host, "github.com");
    assert.strictEqual(Redacted.value(first!.token), "token-work");
    expect(first!.credentialFingerprint).toMatch(/^github\.com:work:[0-9a-f]{64}$/);
    expect(first!.credentialFingerprint).not.toContain("token-work");

    yield* TestClock.adjust("6 minutes");
    yield* selector.pinFor({ cwd: "/repo" });
    assert.strictEqual(commands.length, 2);

    yield* selector.invalidate({ host: "github.com", login: "work" });
    yield* selector.pinFor({ cwd: "/repo" });
    assert.strictEqual(commands.length, 3);
  }),
);

it.effect("returns no pin when gh has no token for the account", () =>
  Effect.gen(function* () {
    const commands: Array<ReadonlyArray<string>> = [];
    const selector = yield* makeSelector({
      identities: { "/repo": identity({ rootPath: "/repo", owner: "geico-private" }) },
      settings: { gitHubAccountRules: [workRule] },
      commands,
      token: () =>
        Effect.fail(
          new VcsProcessExitError({
            operation: "GitHubAccountSelector.token",
            command: "gh",
            cwd: "/repo",
            exitCode: 1,
            detail: "no such account",
          }),
        ),
    });
    assert.isNull(yield* selector.pinFor({ cwd: "/repo" }));
    // A failure is not cached: the next request asks again so a fresh login takes effect.
    assert.isNull(yield* selector.pinFor({ cwd: "/repo" }));
    assert.strictEqual(commands.length, 2);
  }),
);
