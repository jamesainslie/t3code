// Fork: roadmap. GitHub sync imports issues by URL. Change request URLs are
// parsed by each forge's client definition; this module only reads issues.
export interface GitHubIssueLink {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * A GitHub issue page on any host, since Enterprise Server hosts carry no
 * telltale name. Owner and repo keep their case: GitHub resolves either, and
 * the item shows what the user pasted.
 */
export function parseGitHubIssueUrl(targetUrl: string): GitHubIssueLink | null {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const match = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$)/u.exec(url.pathname);
  const number = Number(match?.[3]);
  if (match === null || !Number.isSafeInteger(number) || number <= 0) return null;
  return { host: url.hostname.toLowerCase(), owner: match[1]!, repo: match[2]!, number };
}
