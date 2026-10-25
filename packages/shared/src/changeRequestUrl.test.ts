import { describe, expect, it } from "vite-plus/test";

import { parseGitHubIssueUrl } from "./changeRequestUrl.ts";

describe("parseGitHubIssueUrl", () => {
  it("reads the host, owner, repository and number of a GitHub issue", () => {
    expect(parseGitHubIssueUrl("https://github.com/Acme/Web/issues/123")).toEqual({
      host: "github.com",
      owner: "Acme",
      repo: "Web",
      number: 123,
    });
    expect(
      parseGitHubIssueUrl("https://GitHub.Acme.test/acme/web/issues/9#issuecomment-1"),
    ).toEqual({ host: "github.acme.test", owner: "acme", repo: "web", number: 9 });
  });

  it.each([
    "https://github.com/acme/web/pull/7",
    "https://github.com/acme/web/issues",
    "https://github.com/acme/web/issues/0",
    "https://github.com/acme/issues/12",
    "ftp://github.com/acme/web/issues/1",
    "not a url",
  ])("refuses %s", (url) => {
    expect(parseGitHubIssueUrl(url)).toBeNull();
  });
});
