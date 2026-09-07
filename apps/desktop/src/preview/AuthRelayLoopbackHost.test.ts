// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off -- The subject binds a real loopback port, so the test drives it with a real browser-shaped request.
import { it as effectIt } from "@effect/vitest";
import type { DesktopPreviewAuthRelayCallback } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as NodeHttp from "node:http";
import { describe, expect } from "vite-plus/test";

import * as AuthRelayLoopbackHost from "./AuthRelayLoopbackHost.ts";
import { AUTH_RELAY_RETURN_PAGE_HTML } from "./AuthRelayReturnPage.ts";

/**
 * The host has to bind the exact port the sign-in advertised, so tests cannot
 * ask for port 0. Binding a throwaway server and releasing it names a port
 * that is free right now.
 */
const freePort = Effect.callback<number>((resume) => {
  const probe = NodeHttp.createServer();
  probe.listen({ host: "127.0.0.1", port: 0 }, () => {
    const address = probe.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    probe.close(() => resume(Effect.succeed(port)));
  });
});

const occupyPort = (port: number) =>
  Effect.acquireRelease(
    Effect.callback<NodeHttp.Server>((resume) => {
      const server = NodeHttp.createServer((_request, response) => response.end("busy"));
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
        resume(Effect.succeed(server)),
      );
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      }),
  );

const request = (url: string, init?: RequestInit) =>
  Effect.promise(async () => {
    const response = await fetch(url, init);
    return { status: response.status, body: await response.text() };
  });

interface HostFixture {
  readonly host: AuthRelayLoopbackHost.AuthRelayLoopbackHost["Service"];
  readonly port: number;
  readonly events: Ref.Ref<ReadonlyArray<DesktopPreviewAuthRelayCallback>>;
  readonly firstEvent: Deferred.Deferred<DesktopPreviewAuthRelayCallback>;
}

const withHost = <A>(use: (fixture: HostFixture) => Effect.Effect<A, never, never>) =>
  Effect.gen(function* () {
    const host = yield* AuthRelayLoopbackHost.AuthRelayLoopbackHost;
    const port = yield* freePort;
    const events = yield* Ref.make<ReadonlyArray<DesktopPreviewAuthRelayCallback>>([]);
    const firstEvent = yield* Deferred.make<DesktopPreviewAuthRelayCallback>();
    yield* host.subscribe((event) =>
      Ref.update(events, (previous) => [...previous, event]).pipe(
        Effect.andThen(Deferred.succeed(firstEvent, event)),
        Effect.asVoid,
      ),
    );
    return yield* use({ host, port, events, firstEvent });
  }).pipe(Effect.provide(AuthRelayLoopbackHost.layer), Effect.scoped);

describe("AuthRelayLoopbackHost", () => {
  effectIt.effect("hands a loopback GET to the renderer with the advertised origin", () =>
    withHost(({ host, port, firstEvent, events }) =>
      Effect.gen(function* () {
        expect(
          yield* host.host({
            hostId: "capture_1",
            origin: `http://127.0.0.1:${port}`,
            path: "/callback",
          }),
        ).toEqual({ hosted: true });

        const mismatched = yield* request(`http://127.0.0.1:${port}/other?code=nope`);
        expect(mismatched.status).toBe(404);

        const returned = yield* request(`http://127.0.0.1:${port}/callback?code=abc&state=s`);
        expect(returned.status).toBe(200);
        expect(returned.body).toBe(AUTH_RELAY_RETURN_PAGE_HTML);

        expect(yield* Deferred.await(firstEvent)).toEqual({
          tabId: null,
          hostId: "capture_1",
          url: `http://127.0.0.1:${port}/callback?code=abc&state=s`,
          method: "GET",
          body: null,
        });

        // The environment consumed that response; a reload must not replay it.
        const again = yield* request(`http://127.0.0.1:${port}/callback?code=abc&state=s`);
        expect(again.status).toBe(200);
        expect(yield* Ref.get(events)).toHaveLength(1);
      }),
    ),
  );

  effectIt.effect("hands a form POST body to the renderer", () =>
    withHost(({ host, port, firstEvent }) =>
      Effect.gen(function* () {
        expect(
          yield* host.host({ hostId: "capture_2", origin: `http://localhost:${port}`, path: null }),
        ).toEqual({ hosted: true });

        const returned = yield* request(`http://127.0.0.1:${port}/`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "code=abc&state=s",
        });
        expect(returned.status).toBe(200);

        // The url carries the origin exactly as advertised so the environment's
        // own origin check passes, whichever loopback name the browser used.
        expect(yield* Deferred.await(firstEvent)).toEqual({
          tabId: null,
          hostId: "capture_2",
          url: `http://localhost:${port}/`,
          method: "POST",
          body: "code=abc&state=s",
        });
      }),
    ),
  );

  effectIt.effect("ignores the browser's favicon request", () =>
    withHost(({ host, port, firstEvent, events }) =>
      Effect.gen(function* () {
        yield* host.host({ hostId: "capture_3", origin: `http://127.0.0.1:${port}`, path: null });

        expect((yield* request(`http://127.0.0.1:${port}/favicon.ico`)).status).toBe(204);
        yield* request(`http://127.0.0.1:${port}/?code=abc`);

        expect(yield* Deferred.await(firstEvent)).toMatchObject({
          url: `http://127.0.0.1:${port}/?code=abc`,
        });
        expect(yield* Ref.get(events)).toHaveLength(1);
      }),
    ),
  );

  effectIt.effect("declines a port another listener already holds", () =>
    withHost(({ host, port }) =>
      Effect.gen(function* () {
        yield* occupyPort(port);
        expect(
          yield* host.host({ hostId: "capture_4", origin: `http://127.0.0.1:${port}`, path: null }),
        ).toEqual({ hosted: false });
        // The failed attempt must not have claimed the id either.
        expect(
          yield* host.host({ hostId: "capture_4", origin: `http://127.0.0.1:${port}`, path: null }),
        ).toEqual({ hosted: false });
      }).pipe(Effect.scoped),
    ),
  );

  effectIt.effect("declines a second capture that wants a port it already hosts", () =>
    withHost(({ host, port }) =>
      Effect.gen(function* () {
        yield* host.host({ hostId: "capture_5", origin: `http://127.0.0.1:${port}`, path: null });
        expect(
          yield* host.host({ hostId: "capture_6", origin: `http://127.0.0.1:${port}`, path: null }),
        ).toEqual({ hosted: false });
      }),
    ),
  );

  effectIt.effect("declines an origin that is not an unprivileged loopback port", () =>
    withHost(({ host }) =>
      Effect.gen(function* () {
        expect(
          yield* host.host({ hostId: "capture_7", origin: "https://example.com", path: null }),
        ).toEqual({ hosted: false });
        expect(
          yield* host.host({ hostId: "capture_8", origin: "http://127.0.0.1:80", path: null }),
        ).toEqual({ hosted: false });
      }),
    ),
  );

  effectIt.effect("gives the port back on release", () =>
    withHost(({ host, port }) =>
      Effect.gen(function* () {
        yield* host.host({ hostId: "capture_9", origin: `http://127.0.0.1:${port}`, path: null });
        expect((yield* request(`http://127.0.0.1:${port}/?code=abc`)).status).toBe(200);

        yield* host.release("capture_9");
        yield* host.release("capture_9");

        const refused = yield* request(`http://127.0.0.1:${port}/?code=abc`).pipe(Effect.exit);
        expect(refused._tag).toBe("Failure");
      }),
    ),
  );
});
