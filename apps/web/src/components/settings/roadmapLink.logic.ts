import type { RoadmapLinkStatus } from "@lathe/contracts";

import { formatElapsedDurationLabel } from "~/timestampFormat";

/** The host people recognise, not the whole URL; anything unparseable as is. */
export function roadmapLinkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const changes = (count: number) => (count === 1 ? "1 change" : `${count} changes`);

/** One line for Settings: where the link goes, whether it answers, and what waits. */
export function describeRoadmapLink(
  status: RoadmapLinkStatus,
  nowMs: number,
): { readonly tone: "ok" | "warning" | "muted"; readonly text: string } {
  if (status.state === "not-linked" || status.homeUrl === null) {
    return { tone: "muted", text: "Not linked. Agents here cannot reach the roadmap." };
  }
  const host = roadmapLinkHost(status.homeUrl);
  const elapsed =
    status.unreachableSince === null
      ? ""
      : formatElapsedDurationLabel(status.unreachableSince, nowMs);
  const lead =
    status.state === "unreachable"
      ? elapsed === "" || elapsed === "just now"
        ? `Cannot reach ${host}.`
        : `Cannot reach ${host} for ${elapsed}.`
      : `Linked to ${host}.`;
  const parts = [
    lead,
    ...(status.queued > 0 ? [`${changes(status.queued)} waiting.`] : []),
    ...(status.rejected > 0 ? [`${changes(status.rejected)} refused by the home.`] : []),
  ];
  return {
    tone: status.state === "unreachable" || status.rejected > 0 ? "warning" : "ok",
    text: parts.join(" "),
  };
}
