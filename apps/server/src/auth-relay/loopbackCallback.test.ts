// @effect-diagnostics-next-line nodeBuiltinImport:off - the replay test needs a real loopback listener.
import * as NodeHttp from "node:http";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  forwardLoopbackCallback,
  parseLoopbackRedirectUri,
  readLoopbackCallbackResponse,
  readPastedAuthorizationCode,
  validateLoopbackCallbackUrl,
} from "./loopbackCallback.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

describe("parseLoopbackRedirectUri", () => {
  it("accepts unprivileged loopback origins with any path", () => {
    for (const value of [
      "http://127.0.0.1:51234/",
      "http://localhost:1455/auth/callback",
      "http://127.0.0.1:1024/callback",
    ]) {
      assert.equal(parseLoopbackRedirectUri(value)?.href, value);
    }
  });

  it("rejects other hosts, schemes, privileged ports, credentials, queries, and fragments", () => {
    for (const value of [
      "https://127.0.0.1:51234/",
      "http://127.0.0.2:51234/",
      "http://169.254.169.254:51234/",
      "http://[::1]:51234/",
      "http://127.0.0.1:80/",
      "http://127.0.0.1:1023/",
      "http://127.0.0.1/",
      "http://127.0.0.1:70000/",
      "http://user:secret@127.0.0.1:51234/",
      "http://127.0.0.1:51234/?next=1",
      "http://127.0.0.1:51234/#fragment",
      "not a url",
      "",
    ]) {
      assert.isNull(parseLoopbackRedirectUri(value), value);
    }
  });
});

describe("validateLoopbackCallbackUrl", () => {
  const pending = { redirectUri: "http://127.0.0.1:51234/callback", state: "owned-state" };

  it.effect("accepts the exact owned callback with one code or one error", () =>
    Effect.gen(function* () {
      for (const response of ["code=example-code", "error=access_denied"]) {
        const callback = `http://127.0.0.1:51234/callback?state=owned-state&${response}`;
        const parsed = yield* validateLoopbackCallbackUrl(pending, callback);
        assert.equal(parsed.toString(), callback);
      }
    }),
  );

  it.effect("accepts a localhost callback for a localhost listener", () =>
    Effect.gen(function* () {
      const parsed = yield* validateLoopbackCallbackUrl(
        { redirectUri: "http://localhost:1455/auth/callback" },
        "http://localhost:1455/auth/callback?code=x&state=anything",
      );
      assert.equal(parsed.port, "1455");
    }),
  );

  it.effect("requires exact state only when one is registered", () =>
    Effect.gen(function* () {
      const unregistered = { redirectUri: "http://127.0.0.1:51234/callback" };
      yield* validateLoopbackCallbackUrl(unregistered, "http://127.0.0.1:51234/callback?code=x");
      yield* validateLoopbackCallbackUrl(
        unregistered,
        "http://127.0.0.1:51234/callback?code=x&state=whatever",
      );
      const missing = yield* validateLoopbackCallbackUrl(
        pending,
        "http://127.0.0.1:51234/callback?code=x",
      ).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(missing));
    }),
  );

  it.effect("rejects other targets, credentials, fragments, and duplicate OAuth fields", () =>
    Effect.gen(function* () {
      const callbacks = [
        "https://127.0.0.1:51234/callback?state=owned-state&code=x",
        "http://localhost:51234/callback?state=owned-state&code=x",
        "http://127.0.0.2:51234/callback?state=owned-state&code=x",
        "http://127.0.0.1:51235/callback?state=owned-state&code=x",
        "http://127.0.0.1:51234/other?state=owned-state&code=x",
        "http://127.0.0.1:51234/?state=owned-state&code=x",
        "http://user:password@127.0.0.1:51234/callback?state=owned-state&code=x",
        "http://127.0.0.1:51234/callback?state=owned-state&code=x#fragment",
        "http://127.0.0.1:51234/callback?state=wrong-state&code=x",
        "http://127.0.0.1:51234/callback?state=owned-state&state=owned-state&code=x",
        "http://127.0.0.1:51234/callback?state=owned-state&code=x&code=y",
        "http://127.0.0.1:51234/callback?state=owned-state&code=x&error=access_denied",
        "http://127.0.0.1:51234/callback?state=owned-state&error=access_denied&error=other",
        "http://127.0.0.1:51234/callback?state=owned-state&code=",
        "http://127.0.0.1:51234/callback?state=owned-state",
        `http://127.0.0.1:51234/callback?state=owned-state&code=${"x".repeat(17_000)}`,
        "not a url with secret-code",
      ];
      for (const callback of callbacks) {
        const result = yield* validateLoopbackCallbackUrl(pending, callback).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result), callback);
        if (Exit.isFailure(result)) {
          assert.notInclude(encodeUnknownJson(result.cause), "secret-code");
          assert.notInclude(encodeUnknownJson(result.cause), "owned-state");
        }
      }
    }),
  );
});

describe("readLoopbackCallbackResponse", () => {
  it("reads the single code or error and the state", () => {
    assert.deepEqual(
      readLoopbackCallbackResponse(new URL("http://127.0.0.1:51234/?code=abc&state=s")),
      { code: "abc", state: "s" },
    );
    assert.deepEqual(
      readLoopbackCallbackResponse(new URL("http://127.0.0.1:51234/?error=denied")),
      { error: "denied", state: null },
    );
  });
});

describe("forwardLoopbackCallback", () => {
  it.effect("sends one GET to the listener without following redirects", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const server = NodeHttp.createServer((request, response) => {
        requests.push(request.url ?? "");
        if (request.url?.startsWith("/redirect")) {
          response.writeHead(302, { location: "/elsewhere" });
          response.end();
          return;
        }
        response.writeHead(200);
        response.end("ok");
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => void server.close()));
      const port = yield* Effect.callback<number>((resume) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resume(Effect.succeed(typeof address === "object" && address ? address.port : 0));
        });
      });
      yield* forwardLoopbackCallback(new URL(`http://127.0.0.1:${port}/callback?code=x&state=s`));
      assert.deepEqual(requests, ["/callback?code=x&state=s"]);

      const redirected = yield* forwardLoopbackCallback(
        new URL(`http://127.0.0.1:${port}/redirect?code=x`),
      ).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(redirected));
      assert.deepEqual(requests, ["/callback?code=x&state=s", "/redirect?code=x"]);
    }).pipe(Effect.scoped),
  );

  it.effect("fails safely when nothing listens on the port", () =>
    Effect.gen(function* () {
      const server = NodeHttp.createServer();
      const port = yield* Effect.callback<number>((resume) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const value = typeof address === "object" && address ? address.port : 0;
          server.close(() => resume(Effect.succeed(value)));
        });
      });
      const result = yield* forwardLoopbackCallback(
        new URL(`http://127.0.0.1:${port}/?code=secret-code`),
      ).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        assert.notInclude(encodeUnknownJson(result.cause), "secret-code");
      }
    }),
  );
});

describe("readPastedAuthorizationCode", () => {
  it.effect("accepts the hosted callback address, a bare code, and code#state", () =>
    Effect.gen(function* () {
      const fromUrl = yield* readPastedAuthorizationCode(
        "expected",
        "https://platform.example.com/oauth/code/callback?code=abc&state=expected",
      );
      assert.deepEqual(fromUrl, { code: "abc", state: "expected" });
      assert.deepEqual(yield* readPastedAuthorizationCode("expected", " abc "), {
        code: "abc",
        state: "expected",
      });
      assert.deepEqual(yield* readPastedAuthorizationCode(null, "abc#other"), {
        code: "abc",
        state: "other",
      });
    }),
  );

  it.effect("rejects a foreign state, an insecure address, and anything with whitespace", () =>
    Effect.gen(function* () {
      for (const value of [
        "abc#other",
        "http://platform.example.com/oauth/code/callback?code=abc&state=expected",
        "https://platform.example.com/oauth/code/callback?state=expected",
        "https://platform.example.com/oauth/code/callback?code=abc&state=other",
        "abc def",
        "",
        `${"a".repeat(3_000)}#expected`,
      ]) {
        const result = yield* readPastedAuthorizationCode("expected", value).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result), value);
      }
    }),
  );
});
