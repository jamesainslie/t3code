/**
 * Fork-only: what a background text-generation call was for, so the Usage tab
 * can show that spend apart from the provider's own sessions. Upstream usage
 * contracts reach this through one optional bucket field.
 */
import * as Schema from "effect/Schema";

export const BackgroundGenerationPurpose = Schema.Literals([
  "threadTitle",
  "branchName",
  "commitMessage",
  "prContent",
  "reviewGuide",
  "roadmapSteward",
]);
export type BackgroundGenerationPurpose = typeof BackgroundGenerationPurpose.Type;

const PURPOSE_LABELS: Record<BackgroundGenerationPurpose, string> = {
  threadTitle: "Thread titles",
  branchName: "Branch names",
  commitMessage: "Commit messages",
  prContent: "Pull request text",
  reviewGuide: "Review guides",
  roadmapSteward: "Roadmap steward",
};

/**
 * Buckets carry the purpose as a plain string: a newer server's purpose must
 * still count on an older client, so an unknown one gets a generic label
 * rather than failing to decode.
 */
export function backgroundGenerationPurposeLabel(purpose: string): string {
  return Object.hasOwn(PURPOSE_LABELS, purpose)
    ? PURPOSE_LABELS[purpose as BackgroundGenerationPurpose]
    : "Background generation";
}
