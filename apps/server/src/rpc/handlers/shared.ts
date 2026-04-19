// Shared helpers and dependency plumbing for WS RPC handlers.
//
// `makeHandlerDeps` builds a flat `deps` object from already-resolved service
// instances. Handlers import the `HandlerDeps` type and destructure whatever
// they need. Helpers that need services (for example `refreshGitStatus`,
// `loadServerConfig`, `dispatchBootstrapTurnStart`) are created inside this
// factory so they close over the resolved services.
//
// Module-level helpers that only depend on their inputs (no services) live
// at the top of this file.

import { Cause, Effect, Option, Schema } from "effect";
import {
  type AuthAccessStreamEvent,
  type AuthSessionId,
  CommandId,
  EventId,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  ThreadId,
} from "@t3tools/contracts";

import type { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "../../config.ts";
import type { HostResourceMonitor } from "../../hostResource/Services/HostResourceMonitor.ts";
import type { GitCore } from "../../git/Services/GitCore.ts";
import type { GitManager } from "../../git/Services/GitManager.ts";
import type { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import type { Keybindings } from "../../keybindings.ts";
import type { Open } from "../../open.ts";
import { resolveAvailableEditors } from "../../open.ts";
import type { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import type { ServerLifecycleEvents } from "../../serverLifecycleEvents.ts";
import type { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import type { ServerSettingsService } from "../../serverSettings.ts";
import type { TerminalManager } from "../../terminal/Services/Manager.ts";
import type { WorkspaceEntries } from "../../workspace/Services/WorkspaceEntries.ts";
import type { WorkspaceFileSystem } from "../../workspace/Services/WorkspaceFileSystem.ts";
import type { FileDocsService } from "../../projectFiles/Services/FileDocsService.ts";
import type { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import type { RepositoryIdentityResolver } from "../../project/Services/RepositoryIdentityResolver.ts";
import type { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import type { ServerAuth } from "../../auth/Services/ServerAuth.ts";
import type {
  BootstrapCredentialService,
  BootstrapCredentialChange,
} from "../../auth/Services/BootstrapCredentialService.ts";
import type {
  SessionCredentialService,
  SessionCredentialChange,
} from "../../auth/Services/SessionCredentialService.ts";

/**
 * Debounce interval applied to the provider-status stream emitted on
 * `subscribeServerConfig`.
 */
export const PROVIDER_STATUS_DEBOUNCE_MS = 200;

/**
 * Refine an orchestration event down to the subset tracked by the
 * `subscribeThread` stream. Pure — no service dependency.
 */
export function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

/**
 * Map an auth credential change to the stream-event shape consumed by
 * `subscribeAuthAccess`. Pure — takes the current session id as input so it
 * can flag the caller's own session.
 */
export function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

/**
 * Services resolved inside `makeWsRpcLayer` and passed to every domain
 * registry factory.
 */
export interface ResolvedServices {
  readonly projectionSnapshotQuery: typeof ProjectionSnapshotQuery.Service;
  readonly orchestrationEngine: typeof OrchestrationEngineService.Service;
  readonly checkpointDiffQuery: typeof CheckpointDiffQuery.Service;
  readonly keybindings: typeof Keybindings.Service;
  readonly open: typeof Open.Service;
  readonly gitManager: typeof GitManager.Service;
  readonly git: typeof GitCore.Service;
  readonly gitStatusBroadcaster: typeof GitStatusBroadcaster.Service;
  readonly terminalManager: typeof TerminalManager.Service;
  readonly providerRegistry: typeof ProviderRegistry.Service;
  readonly config: typeof ServerConfig.Service;
  readonly lifecycleEvents: typeof ServerLifecycleEvents.Service;
  readonly serverSettings: typeof ServerSettingsService.Service;
  readonly startup: typeof ServerRuntimeStartup.Service;
  readonly workspaceEntries: typeof WorkspaceEntries.Service;
  readonly workspaceFileSystem: typeof WorkspaceFileSystem.Service;
  readonly fileDocs: typeof FileDocsService.Service;
  readonly projectSetupScriptRunner: typeof ProjectSetupScriptRunner.Service;
  readonly repositoryIdentityResolver: typeof RepositoryIdentityResolver.Service;
  readonly serverEnvironment: typeof ServerEnvironment.Service;
  readonly serverAuth: typeof ServerAuth.Service;
  readonly bootstrapCredentials: typeof BootstrapCredentialService.Service;
  readonly sessions: typeof SessionCredentialService.Service;
  readonly hostResourceMonitor: typeof HostResourceMonitor.Service;
}

/**
 * Build the shared helpers bag from resolved services. Called once from
 * `makeWsRpcLayer` inside the `Effect.gen` body.
 */
export function makeHandlerHelpers(services: ResolvedServices, currentSessionId: AuthSessionId) {
  const {
    orchestrationEngine,
    projectionSnapshotQuery,
    repositoryIdentityResolver,
    gitStatusBroadcaster,
    git,
    startup,
    projectSetupScriptRunner,
    keybindings,
    providerRegistry,
    serverSettings,
    serverEnvironment,
    serverAuth,
    config,
  } = services;

  const serverCommandId = (tag: string) => CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

  const loadAuthAccessSnapshot = () =>
    Effect.all({
      pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
      clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
    });

  const appendSetupScriptActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
    readonly summary: string;
    readonly createdAt: string;
    readonly payload: Record<string, unknown>;
    readonly tone: "info" | "error";
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("setup-script-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(crypto.randomUUID()),
        tone: input.tone,
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
    Schema.is(OrchestrationDispatchCommandError)(cause)
      ? cause
      : new OrchestrationDispatchCommandError({
          message: cause instanceof Error ? cause.message : fallbackMessage,
          cause,
        });

  const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
    const error = Cause.squash(cause);
    return Schema.is(OrchestrationDispatchCommandError)(error)
      ? error
      : new OrchestrationDispatchCommandError({
          message:
            error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
          cause,
        });
  };

  const enrichProjectEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<OrchestrationEvent, never, never> => {
    switch (event.type) {
      case "project.created":
        return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
          Effect.map((repositoryIdentity) => ({
            ...event,
            payload: {
              ...event.payload,
              repositoryIdentity,
            },
          })),
        );
      case "project.meta-updated":
        return Effect.gen(function* () {
          const workspaceRoot =
            event.payload.workspaceRoot ??
            (yield* orchestrationEngine.getReadModel()).projects.find(
              (project) => project.id === event.payload.projectId,
            )?.workspaceRoot ??
            null;
          if (workspaceRoot === null) {
            return event;
          }

          const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
          return {
            ...event,
            payload: {
              ...event.payload,
              repositoryIdentity,
            },
          } satisfies OrchestrationEvent;
        });
      default:
        return Effect.succeed(event);
    }
  };

  const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
    Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

  const toShellStreamEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
          Effect.map((project) =>
            Option.map(project, (nextProject) => ({
              kind: "project-upserted" as const,
              sequence: event.sequence,
              project: nextProject,
            })),
          ),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
      case "project.deleted":
        return Effect.succeed(
          Option.some({
            kind: "project-removed" as const,
            sequence: event.sequence,
            projectId: event.payload.projectId,
          }),
        );
      case "thread.deleted":
        return Effect.succeed(
          Option.some({
            kind: "thread-removed" as const,
            sequence: event.sequence,
            threadId: event.payload.threadId,
          }),
        );
      default:
        if (event.aggregateKind !== "thread") {
          return Effect.succeed(Option.none());
        }
        return projectionSnapshotQuery.getThreadShellById(ThreadId.make(event.aggregateId)).pipe(
          Effect.map((thread) =>
            Option.map(thread, (nextThread) => ({
              kind: "thread-upserted" as const,
              sequence: event.sequence,
              thread: nextThread,
            })),
          ),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
    }
  };

  const refreshGitStatus = (cwd: string) =>
    gitStatusBroadcaster
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const dispatchBootstrapTurnStart = (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
    Effect.gen(function* () {
      const bootstrap = command.bootstrap;
      const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
      let createdThread = false;
      const targetProjectId = bootstrap?.createThread?.projectId;
      const targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
      let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

      const cleanupCreatedThread = () =>
        createdThread
          ? orchestrationEngine
              .dispatch({
                type: "thread.delete",
                commandId: serverCommandId("bootstrap-thread-delete"),
                threadId: command.threadId,
              })
              .pipe(Effect.ignoreCause({ log: true }))
          : Effect.void;

      const recordSetupScriptLaunchFailure = (input: {
        readonly error: unknown;
        readonly requestedAt: string;
        readonly worktreePath: string;
      }) => {
        const detail =
          input.error instanceof Error ? input.error.message : "Unknown setup failure.";
        return appendSetupScriptActivity({
          threadId: command.threadId,
          kind: "setup-script.failed",
          summary: "Setup script failed to start",
          createdAt: input.requestedAt,
          payload: {
            detail,
            worktreePath: input.worktreePath,
          },
          tone: "error",
        }).pipe(
          Effect.ignoreCause({ log: false }),
          Effect.flatMap(() =>
            Effect.logWarning("bootstrap turn start failed to launch setup script", {
              threadId: command.threadId,
              worktreePath: input.worktreePath,
              detail,
            }),
          ),
        );
      };

      const recordSetupScriptStarted = (input: {
        readonly requestedAt: string;
        readonly worktreePath: string;
        readonly scriptId: string;
        readonly scriptName: string;
        readonly terminalId: string;
      }) => {
        const payload = {
          scriptId: input.scriptId,
          scriptName: input.scriptName,
          terminalId: input.terminalId,
          worktreePath: input.worktreePath,
        };
        return Effect.all([
          appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.requested",
            summary: "Starting setup script",
            createdAt: input.requestedAt,
            payload,
            tone: "info",
          }),
          appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.started",
            summary: "Setup script started",
            createdAt: new Date().toISOString(),
            payload,
            tone: "info",
          }),
        ]).pipe(
          Effect.asVoid,
          Effect.catch((error) =>
            Effect.logWarning(
              "bootstrap turn start launched setup script but failed to record setup activity",
              {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                scriptId: input.scriptId,
                terminalId: input.terminalId,
                detail: error.message,
              },
            ),
          ),
        );
      };

      const runSetupProgram = () =>
        bootstrap?.runSetupScript && targetWorktreePath
          ? (() => {
              const worktreePath = targetWorktreePath;
              const requestedAt = new Date().toISOString();
              return projectSetupScriptRunner
                .runForThread({
                  threadId: command.threadId,
                  ...(targetProjectId ? { projectId: targetProjectId } : {}),
                  ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                  worktreePath,
                })
                .pipe(
                  Effect.matchEffect({
                    onFailure: (error) =>
                      recordSetupScriptLaunchFailure({
                        error,
                        requestedAt,
                        worktreePath,
                      }),
                    onSuccess: (setupResult) => {
                      if (setupResult.status !== "started") {
                        return Effect.void;
                      }
                      return recordSetupScriptStarted({
                        requestedAt,
                        worktreePath,
                        scriptId: setupResult.scriptId,
                        scriptName: setupResult.scriptName,
                        terminalId: setupResult.terminalId,
                      });
                    },
                  }),
                );
            })()
          : Effect.void;

      const bootstrapProgram = Effect.gen(function* () {
        if (bootstrap?.createThread) {
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: serverCommandId("bootstrap-thread-create"),
            threadId: command.threadId,
            projectId: bootstrap.createThread.projectId,
            title: bootstrap.createThread.title,
            modelSelection: bootstrap.createThread.modelSelection,
            runtimeMode: bootstrap.createThread.runtimeMode,
            interactionMode: bootstrap.createThread.interactionMode,
            branch: bootstrap.createThread.branch,
            worktreePath: bootstrap.createThread.worktreePath,
            createdAt: bootstrap.createThread.createdAt,
          });
          createdThread = true;
        }

        if (bootstrap?.prepareWorktree) {
          const worktree = yield* git.createWorktree({
            cwd: bootstrap.prepareWorktree.projectCwd,
            branch: bootstrap.prepareWorktree.baseBranch,
            newBranch: bootstrap.prepareWorktree.branch,
            path: null,
          });
          targetWorktreePath = worktree.worktree.path;
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: serverCommandId("bootstrap-thread-meta-update"),
            threadId: command.threadId,
            branch: worktree.worktree.branch,
            worktreePath: targetWorktreePath,
          });
          yield* refreshGitStatus(targetWorktreePath);
        }

        yield* runSetupProgram();

        return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
      });

      return yield* bootstrapProgram.pipe(
        Effect.catchCause((cause) => {
          const dispatchError = toBootstrapDispatchCommandCauseError(cause);
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.fail(dispatchError);
          }
          return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
        }),
      );
    });

  const dispatchNormalizedCommand = (
    normalizedCommand: OrchestrationCommand,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
    const dispatchEffect =
      normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
        ? dispatchBootstrapTurnStart(normalizedCommand)
        : orchestrationEngine
            .dispatch(normalizedCommand)
            .pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
              ),
            );

    return startup
      .enqueueCommand(dispatchEffect)
      .pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
        ),
      );
  };

  const loadServerConfig = Effect.gen(function* () {
    const keybindingsConfig = yield* keybindings.loadConfigState;
    const providers = yield* providerRegistry.getProviders;
    const settings = yield* serverSettings.getSettings;
    const environment = yield* serverEnvironment.getDescriptor;
    const auth = yield* serverAuth.getDescriptor();

    return {
      environment,
      auth,
      cwd: config.cwd,
      keybindingsConfigPath: config.keybindingsConfigPath,
      keybindings: keybindingsConfig.keybindings,
      issues: keybindingsConfig.issues,
      providers,
      availableEditors: resolveAvailableEditors(),
      observability: {
        logsDirectoryPath: config.logsDir,
        localTracingEnabled: true,
        ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
        otlpTracesEnabled: config.otlpTracesUrl !== undefined,
        ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
        otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
      },
      settings,
    };
  });

  return {
    serverCommandId,
    loadAuthAccessSnapshot,
    appendSetupScriptActivity,
    toDispatchCommandError,
    toBootstrapDispatchCommandCauseError,
    enrichProjectEvent,
    enrichOrchestrationEvents,
    toShellStreamEvent,
    dispatchBootstrapTurnStart,
    dispatchNormalizedCommand,
    loadServerConfig,
    refreshGitStatus,
  } as const;
}

export type HandlerHelpers = ReturnType<typeof makeHandlerHelpers>;

/**
 * Flat dependency bag passed to each handler factory. Intentionally exposes
 * every resolved service directly alongside a `helpers` sub-object — the
 * shallow shape keeps handler bodies concise.
 */
export interface HandlerDeps extends ResolvedServices {
  readonly currentSessionId: AuthSessionId;
  readonly helpers: HandlerHelpers;
}

/**
 * Assemble the complete `HandlerDeps` for the WS RPC layer. Call once from
 * `makeWsRpcLayer`.
 */
export function makeHandlerDeps(
  services: ResolvedServices,
  currentSessionId: AuthSessionId,
): HandlerDeps {
  return {
    ...services,
    currentSessionId,
    helpers: makeHandlerHelpers(services, currentSessionId),
  };
}
