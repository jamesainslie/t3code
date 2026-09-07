// @effect-diagnostics nodeBuiltinImport:off - the host binds a loopback port a browser on this machine returns to; there is no client, proxy or redirect handling involved.
import * as NodeHttp from "node:http";

import type {
  DesktopPreviewAuthRelayCallback,
  DesktopPreviewHostAuthRelayInput,
  DesktopPreviewHostAuthRelayResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import { AUTH_RELAY_RETURN_PAGE_HTML } from "./AuthRelayReturnPage.ts";

/**
 * Stands in for a sign-in's loopback listener on the client machine.
 *
 * The listener the tool opened lives on the environment and is unreachable
 * from here, so while a capture is pending the desktop binds the same port
 * locally and takes whatever the browser sends back: a GET carrying the code
 * in its query, or the form POST Entra makes with `response_mode=form_post`,
 * whose body no pasted URL could ever carry. Any browser on this machine
 * reaches it, not only an in-app tab.
 *
 * Hosting is best effort. When the port is already taken, `hosted` is false
 * and the caller falls back to the in-app tab interception plus the paste
 * field, which still cover the GET case.
 */
export type AuthRelayCallbackListener = (
  event: DesktopPreviewAuthRelayCallback,
) => Effect.Effect<void>;

const MIN_UNPRIVILEGED_PORT = 1_024;
/** Enough for any authorization response; a larger body is not one. */
const MAX_CALLBACK_BODY_BYTES = 65_536;
/** Outlives the server-side capture (5 minutes) so a hosted port is never orphaned. */
const HOST_LIFETIME = "6 minutes";

interface HostedRelay {
  /** Canonical form of the advertised origin, which is what the environment matches against. */
  readonly origin: string;
  readonly path: string | null;
  readonly port: number;
  readonly servers: Array<NodeHttp.Server>;
  delivered: boolean;
}

/**
 * The port of a loopback origin this host may bind, or null. Mirrors the
 * environment's own rule for a redirect URI it will replay against.
 */
function parseLoopbackOriginPort(origin: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !/^[1-9][0-9]{0,4}$/.test(parsed.port)
  ) {
    return null;
  }
  const port = Number(parsed.port);
  return port < MIN_UNPRIVILEGED_PORT ? null : port;
}

export class AuthRelayLoopbackHost extends Context.Service<
  AuthRelayLoopbackHost,
  {
    readonly host: (
      input: DesktopPreviewHostAuthRelayInput,
    ) => Effect.Effect<DesktopPreviewHostAuthRelayResult>;
    readonly release: (hostId: string) => Effect.Effect<void>;
    readonly subscribe: (
      listener: AuthRelayCallbackListener,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/preview/AuthRelayLoopbackHost") {}

const listen = (server: NodeHttp.Server, hostname: string, port: number) =>
  Effect.callback<boolean>((resume) => {
    const onError = () => {
      server.close();
      resume(Effect.succeed(false));
    };
    server.once("error", onError);
    // `exclusive` so a port another listener already holds is refused rather
    // than silently shared, which would make delivery a coin flip.
    server.listen({ host: hostname, port, exclusive: true }, () => {
      server.off("error", onError);
      resume(Effect.succeed(true));
    });
  });

const closeServer = (server: NodeHttp.Server) =>
  Effect.callback<void>((resume) => {
    // Keep-alive connections would otherwise hold the close callback open long
    // after the port itself stopped accepting.
    server.closeAllConnections();
    server.close(() => resume(Effect.void));
  });

export const make = Effect.gen(function* AuthRelayLoopbackHostMake() {
  const parentScope = yield* Scope.Scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const listenersRef = yield* Ref.make<ReadonlySet<AuthRelayCallbackListener>>(new Set());
  const hosts = new Map<string, HostedRelay>();

  const emit = Effect.fn("AuthRelayLoopbackHost.emit")(function* (
    event: DesktopPreviewAuthRelayCallback,
  ) {
    const listeners = yield* Ref.get(listenersRef);
    yield* Effect.forEach(
      listeners,
      (listener) =>
        listener(event).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("Desktop auth relay host listener failed.", {
                  hostId: event.hostId,
                  cause,
                }),
          ),
        ),
      { discard: true },
    );
  });

  const release = Effect.fn("AuthRelayLoopbackHost.release")(function* (hostId: string) {
    const entry = hosts.get(hostId);
    if (entry === undefined) return;
    hosts.delete(hostId);
    const servers = entry.servers.splice(0);
    yield* Effect.forEach(servers, closeServer, { discard: true });
  });

  const respond = (
    response: NodeHttp.ServerResponse,
    status: number,
    body: string,
    contentType = "text/plain; charset=utf-8",
  ) => {
    response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  };

  /**
   * One delivery per host: a browser that reloads the return page, or a second
   * tab that races the first, still gets the page but must not replay the
   * response the environment already consumed.
   */
  const deliver = (
    hostId: string,
    entry: HostedRelay,
    target: string,
    method: "GET" | "POST",
    body: string | null,
  ) => {
    if (entry.delivered) return;
    entry.delivered = true;
    runFork(emit({ tabId: null, hostId, url: `${entry.origin}${target}`, method, body }));
  };

  const readBody = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
    onBody: (body: string) => void,
  ) => {
    const chunks: Array<Buffer> = [];
    let size = 0;
    let abandoned = false;
    request.on("data", (chunk: Buffer) => {
      if (abandoned) return;
      size += chunk.length;
      if (size > MAX_CALLBACK_BODY_BYTES) {
        abandoned = true;
        respond(response, 413, "Payload too large.");
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", () => {
      abandoned = true;
    });
    request.on("end", () => {
      if (!abandoned) onBody(Buffer.concat(chunks).toString("utf8"));
    });
  };

  const handleRequest =
    (hostId: string, entry: HostedRelay) =>
    (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
      const method = request.method === "GET" ? "GET" : request.method === "POST" ? "POST" : null;
      if (method === null) {
        respond(response, 405, "Method not allowed.");
        return;
      }
      const target = request.url ?? "/";
      const queryIndex = target.indexOf("?");
      const path = queryIndex === -1 ? target : target.slice(0, queryIndex);
      // Chromium asks for the favicon of every page it renders, including the
      // return page itself. Answering it as the sign-in response would hand the
      // environment a URL with no code in it.
      if (method === "GET" && queryIndex === -1 && path === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      if (entry.path !== null && path !== entry.path) {
        respond(response, 404, "Not found.");
        return;
      }
      if (method === "GET") {
        deliver(hostId, entry, target, "GET", null);
        respond(response, 200, AUTH_RELAY_RETURN_PAGE_HTML, "text/html; charset=utf-8");
        return;
      }
      readBody(request, response, (body) => {
        deliver(hostId, entry, target, "POST", body);
        respond(response, 200, AUTH_RELAY_RETURN_PAGE_HTML, "text/html; charset=utf-8");
      });
    };

  const host = Effect.fn("AuthRelayLoopbackHost.host")(function* (
    input: DesktopPreviewHostAuthRelayInput,
  ) {
    // Re-hosting the same capture is idempotent; a second capture that wants a
    // port this one already holds falls back to the paste field.
    if (hosts.has(input.hostId)) return { hosted: true };
    const port = parseLoopbackOriginPort(input.origin);
    if (port === null) return { hosted: false };
    if ([...hosts.values()].some((hosted) => hosted.port === port)) return { hosted: false };

    const entry: HostedRelay = {
      origin: new URL(input.origin).origin,
      path: input.path,
      port,
      servers: [],
      delivered: false,
    };
    // Claimed before the first yield so two concurrent captures cannot both
    // decide the port is free.
    hosts.set(input.hostId, entry);

    const ipv4 = NodeHttp.createServer(handleRequest(input.hostId, entry));
    if (!(yield* listen(ipv4, "127.0.0.1", port))) {
      yield* release(input.hostId);
      return { hosted: false };
    }
    entry.servers.push(ipv4);
    // Chromium resolves `localhost` to ::1 first, so the v6 loopback has to be
    // bound too. Machines without IPv6 simply do not get that half.
    const ipv6 = NodeHttp.createServer(handleRequest(input.hostId, entry));
    if (yield* listen(ipv6, "::1", port)) entry.servers.push(ipv6);

    if (hosts.get(input.hostId) !== entry) {
      // Released while the binds were in flight.
      yield* Effect.forEach(entry.servers.splice(0), closeServer, { discard: true });
      return { hosted: false };
    }
    yield* Effect.forkIn(
      Effect.sleep(HOST_LIFETIME).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            hosts.get(input.hostId) === entry ? release(input.hostId) : Effect.void,
          ),
        ),
      ),
      parentScope,
    );
    return { hosted: true };
  });

  yield* Effect.addFinalizer(() => Effect.forEach([...hosts.keys()], release, { discard: true }));

  return AuthRelayLoopbackHost.of({
    host,
    release,
    subscribe: (listener) =>
      Effect.acquireRelease(
        Ref.update(listenersRef, (listeners) => new Set([...listeners, listener])),
        () =>
          Ref.update(listenersRef, (listeners) => {
            const next = new Set(listeners);
            next.delete(listener);
            return next;
          }),
      ).pipe(Effect.asVoid),
  });
}).pipe(Effect.withSpan("AuthRelayLoopbackHost.make"));

export const layer = Layer.effect(AuthRelayLoopbackHost, make);
