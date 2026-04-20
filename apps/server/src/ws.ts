import { Effect, Layer } from "effect";
import { type AuthSessionId, WsRpcGroup } from "@t3tools/contracts";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "./config.ts";
import { HostResourceMonitor } from "./hostResource/Services/HostResourceMonitor.ts";
import { GitCore } from "./git/Services/GitCore.ts";
import { GitManager } from "./git/Services/GitManager.ts";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster.ts";
import { Keybindings } from "./keybindings.ts";
import { Open } from "./open.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { WsClientTracker } from "./wsClientTracker.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem.ts";
import { FileDocsService } from "./projectFiles/Services/FileDocsService.ts";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner.ts";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { BootstrapCredentialService } from "./auth/Services/BootstrapCredentialService.ts";
import { SessionCredentialService } from "./auth/Services/SessionCredentialService.ts";
import { respondToAuthError } from "./auth/http.ts";

import { composeRegistries } from "./rpc/wsMethodRegistry.ts";
import { makeHandlerDeps } from "./rpc/handlers/shared.ts";
import { coreHandlers } from "./rpc/handlers/core.ts";
import { projectsHandlers } from "./rpc/handlers/projects.ts";
import { gitHandlers } from "./rpc/handlers/git.ts";
import { terminalHandlers } from "./rpc/handlers/terminal.ts";
import { orchestrationHandlers } from "./rpc/handlers/orchestration.ts";
import { forkHandlers } from "./rpc/handlers/fork.ts";

const makeWsRpcLayer = (currentSessionId: AuthSessionId) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const services = {
        projectionSnapshotQuery: yield* ProjectionSnapshotQuery,
        orchestrationEngine: yield* OrchestrationEngineService,
        checkpointDiffQuery: yield* CheckpointDiffQuery,
        keybindings: yield* Keybindings,
        open: yield* Open,
        gitManager: yield* GitManager,
        git: yield* GitCore,
        gitStatusBroadcaster: yield* GitStatusBroadcaster,
        terminalManager: yield* TerminalManager,
        providerRegistry: yield* ProviderRegistry,
        config: yield* ServerConfig,
        lifecycleEvents: yield* ServerLifecycleEvents,
        serverSettings: yield* ServerSettingsService,
        startup: yield* ServerRuntimeStartup,
        workspaceEntries: yield* WorkspaceEntries,
        workspaceFileSystem: yield* WorkspaceFileSystem,
        fileDocs: yield* FileDocsService,
        projectSetupScriptRunner: yield* ProjectSetupScriptRunner,
        repositoryIdentityResolver: yield* RepositoryIdentityResolver,
        serverEnvironment: yield* ServerEnvironment,
        serverAuth: yield* ServerAuth,
        bootstrapCredentials: yield* BootstrapCredentialService,
        sessions: yield* SessionCredentialService,
        hostResourceMonitor: yield* HostResourceMonitor,
      } as const;

      const deps = makeHandlerDeps(services, currentSessionId);

      return composeRegistries(
        coreHandlers(deps),
        projectsHandlers(deps),
        gitHandlers(deps),
        terminalHandlers(deps),
        orchestrationHandlers(deps),
        // Fork-only handlers — keep this line last so merges never mangle it.
        forkHandlers(deps),
      );
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const tracker = yield* WsClientTracker;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session.sessionId).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId).pipe(Effect.andThen(tracker.onConnect)),
          () => rpcWebSocketHttpEffect,
          () =>
            sessions.markDisconnected(session.sessionId).pipe(Effect.andThen(tracker.onDisconnect)),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
