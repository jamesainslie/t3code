// Fork: background generation usage. A model's background share is its own
// breakdown row, named for its purpose.
import { backgroundGenerationPurposeLabel, type UsageBucket } from "@lathe/contracts";
import type { ModelTotals } from "@lathe/shared/usageMerge";

export function modelRowKey(model: ModelTotals): string {
  return model.purpose === undefined
    ? `${model.provider}:${model.model}`
    : `${model.provider}:${model.model}:${model.purpose}`;
}

export function modelRowTitle(model: ModelTotals): string {
  return model.purpose === undefined
    ? model.model
    : backgroundGenerationPurposeLabel(model.purpose);
}

export function isModelRowBucket(bucket: UsageBucket, model: ModelTotals): boolean {
  return (
    bucket.provider === model.provider &&
    bucket.model === model.model &&
    bucket.purpose === model.purpose
  );
}
