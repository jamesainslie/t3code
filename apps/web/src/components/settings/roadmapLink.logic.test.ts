import { describe, expect, it } from "vite-plus/test";

import { describeRoadmapLink, roadmapLinkHost } from "./roadmapLink.logic";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");

describe("describeRoadmapLink", () => {
  it("says an environment is not linked yet", () => {
    expect(
      describeRoadmapLink(
        { state: "not-linked", homeUrl: null, unreachableSince: null, queued: 0, rejected: 0 },
        NOW,
      ),
    ).toEqual({ tone: "muted", text: "Not linked. Agents here cannot reach the roadmap." });
  });

  it("names the home a link reaches", () => {
    expect(
      describeRoadmapLink(
        {
          state: "linked",
          homeUrl: "https://desk.tail.ts.net/",
          unreachableSince: null,
          queued: 0,
          rejected: 0,
        },
        NOW,
      ),
    ).toEqual({ tone: "ok", text: "Linked to desk.tail.ts.net." });
  });

  it("counts writes waiting while the home is unreachable, and refused ones", () => {
    expect(
      describeRoadmapLink(
        {
          state: "unreachable",
          homeUrl: "http://desk:3773/",
          unreachableSince: "2026-10-18T09:00:00.000Z",
          queued: 2,
          rejected: 1,
        },
        NOW,
      ),
    ).toEqual({
      tone: "warning",
      text: "Cannot reach desk:3773 for 3h. 2 changes waiting. 1 change refused by the home.",
    });
  });

  it("says one waiting change in the singular", () => {
    expect(
      describeRoadmapLink(
        {
          state: "linked",
          homeUrl: "http://desk:3773/",
          unreachableSince: null,
          queued: 1,
          rejected: 0,
        },
        NOW,
      ).text,
    ).toBe("Linked to desk:3773. 1 change waiting.");
  });
});

describe("roadmapLinkHost", () => {
  it("shows the host of a URL and passes anything else through", () => {
    expect(roadmapLinkHost("https://desk.tail.ts.net/")).toBe("desk.tail.ts.net");
    expect(roadmapLinkHost("not a url")).toBe("not a url");
  });
});
