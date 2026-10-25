import { makeThreadPullRequests } from "@lathe/source-control-core/shared/threadPullRequests";

import { sourceControlDefinitions } from "./sourceControlDefinitions.ts";

export { visibleThreadPullRequests } from "@lathe/shared/threadPullRequests";

export const {
  normalizeThreadPullRequestKey,
  legacyThreadPullRequestKey,
  threadPullRequestKeysEqual,
  threadPullRequestKeyOf,
  resolveThreadPullRequestChains,
  threadPullRequestsOf,
  applyThreadPullRequestLinkUpdate,
} = makeThreadPullRequests(sourceControlDefinitions);
