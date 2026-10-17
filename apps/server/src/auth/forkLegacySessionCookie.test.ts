import { expect, it } from "vite-plus/test";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { selectRequestCredential } from "./EnvironmentAuth.ts";
import { preRenameSessionCookieName } from "./forkLegacySessionCookie.ts";

const requestWithCookie = (cookie: string) =>
  HttpServerRequest.fromWeb(new Request("http://localhost/", { headers: { cookie } }));

it("names the pre-rename session cookie", () => {
  expect(preRenameSessionCookieName("lathe_session_3773_abc")).toBe("t3_session_3773_abc");
});

it("reads a session cookie set before the rename as a legacy cookie", () => {
  expect(
    selectRequestCredential(
      requestWithCookie("t3_session_3773=token"),
      "lathe_session_3773",
      undefined,
    ),
  ).toEqual({ token: "token", source: "legacy-cookie" });
  expect(
    selectRequestCredential(
      requestWithCookie("t3_session_3773=old; lathe_session_3773=new"),
      "lathe_session_3773",
      undefined,
    ),
  ).toEqual({ token: "new", source: "cookie" });
});
