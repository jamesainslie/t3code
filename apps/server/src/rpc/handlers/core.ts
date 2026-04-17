// Core server / settings / lifecycle / auth / filesystem WS RPC handlers.

import { Duration, Effect, Ref, Stream } from "effect";
import { type AuthAccessStreamEvent, FilesystemBrowseError, WS_METHODS } from "@t3tools/contracts";
import type { BootstrapCredentialChange } from "../../auth/Services/BootstrapCredentialService.ts";
import type { SessionCredentialChange } from "../../auth/Services/SessionCredentialService.ts";

import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "../../observability/RpcInstrumentation.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import {
  PROVIDER_STATUS_DEBOUNCE_MS,
  toAuthAccessStreamEvent,
  type HandlerDeps,
} from "./shared.ts";

export function coreHandlers(deps: HandlerDeps) {
  const {
    open,
    workspaceEntries,
    providerRegistry,
    serverSettings,
    keybindings,
    lifecycleEvents,
    bootstrapCredentials,
    sessions,
    currentSessionId,
    helpers,
  } = deps;
  const { loadServerConfig, loadAuthAccessSnapshot } = helpers;

  return {
    [WS_METHODS.serverGetConfig]: (_input) =>
      observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
        "rpc.aggregate": "server",
      }),
    [WS_METHODS.serverRefreshProviders]: (_input) =>
      observeRpcEffect(
        WS_METHODS.serverRefreshProviders,
        providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
        { "rpc.aggregate": "server" },
      ),
    [WS_METHODS.serverUpsertKeybinding]: (rule) =>
      observeRpcEffect(
        WS_METHODS.serverUpsertKeybinding,
        Effect.gen(function* () {
          const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
          return { keybindings: keybindingsConfig, issues: [] };
        }),
        { "rpc.aggregate": "server" },
      ),
    [WS_METHODS.serverGetSettings]: (_input) =>
      observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
        "rpc.aggregate": "server",
      }),
    [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
      observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
        "rpc.aggregate": "server",
      }),
    [WS_METHODS.shellOpenInEditor]: (input) =>
      observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
        "rpc.aggregate": "workspace",
      }),
    [WS_METHODS.filesystemBrowse]: (input) =>
      observeRpcEffect(
        WS_METHODS.filesystemBrowse,
        workspaceEntries.browse(input).pipe(
          Effect.mapError(
            (cause) =>
              new FilesystemBrowseError({
                message: cause.detail,
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "workspace" },
      ),
    [WS_METHODS.subscribeServerConfig]: (_input) =>
      observeRpcStreamEffect(
        WS_METHODS.subscribeServerConfig,
        Effect.gen(function* () {
          const keybindingsUpdates = keybindings.streamChanges.pipe(
            Stream.map((event) => ({
              version: 1 as const,
              type: "keybindingsUpdated" as const,
              payload: {
                issues: event.issues,
              },
            })),
          );
          const providerStatuses = providerRegistry.streamChanges.pipe(
            Stream.map((providers) => ({
              version: 1 as const,
              type: "providerStatuses" as const,
              payload: { providers },
            })),
            Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
          );
          const settingsUpdates = serverSettings.streamChanges.pipe(
            Stream.map((settings) => ({
              version: 1 as const,
              type: "settingsUpdated" as const,
              payload: { settings },
            })),
          );

          yield* Effect.all(
            [providerRegistry.refresh("codex"), providerRegistry.refresh("claudeAgent")],
            {
              concurrency: "unbounded",
              discard: true,
            },
          ).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

          const liveUpdates = Stream.merge(
            keybindingsUpdates,
            Stream.merge(providerStatuses, settingsUpdates),
          );

          return Stream.concat(
            Stream.make({
              version: 1 as const,
              type: "snapshot" as const,
              config: yield* loadServerConfig,
            }),
            liveUpdates,
          );
        }),
        { "rpc.aggregate": "server" },
      ),
    [WS_METHODS.subscribeServerLifecycle]: (_input) =>
      observeRpcStreamEffect(
        WS_METHODS.subscribeServerLifecycle,
        Effect.gen(function* () {
          const snapshot = yield* lifecycleEvents.snapshot;
          const snapshotEvents = Array.from(snapshot.events).toSorted(
            (left, right) => left.sequence - right.sequence,
          );
          const liveEvents = lifecycleEvents.stream.pipe(
            Stream.filter((event) => event.sequence > snapshot.sequence),
          );
          return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
        }),
        { "rpc.aggregate": "server" },
      ),
    [WS_METHODS.subscribeAuthAccess]: (_input) =>
      observeRpcStreamEffect(
        WS_METHODS.subscribeAuthAccess,
        Effect.gen(function* () {
          const initialSnapshot = yield* loadAuthAccessSnapshot();
          const revisionRef = yield* Ref.make(1);
          const accessChanges: Stream.Stream<BootstrapCredentialChange | SessionCredentialChange> =
            Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

          const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
            Stream.mapEffect((change) =>
              Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                Effect.map((revision) =>
                  toAuthAccessStreamEvent(change, revision, currentSessionId),
                ),
              ),
            ),
          );

          return Stream.concat(
            Stream.make({
              version: 1 as const,
              revision: 1,
              type: "snapshot" as const,
              payload: initialSnapshot,
            }),
            liveEvents,
          );
        }),
        { "rpc.aggregate": "auth" },
      ),
    [WS_METHODS.serverSubscribeLogStream]: (_input) =>
      observeRpcStream(WS_METHODS.serverSubscribeLogStream, Stream.empty, {
        "rpc.aggregate": "server",
      }),
  } satisfies WsMethodRegistry;
}
