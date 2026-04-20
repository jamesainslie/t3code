import { Effect, Layer, PubSub, Ref, Schedule, Stream } from "effect";
import type { HostResourceStreamEvent, HostResourceSnapshot } from "@t3tools/contracts";
import { HostResourceMonitor } from "../Services/HostResourceMonitor.ts";
import { ResourceSampler } from "../Services/ResourceSampler.ts";
import { ThresholdEvaluator } from "../Services/ThresholdEvaluator.ts";

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;

export interface HostResourceMonitorOptions {
  readonly sampleIntervalMs?: number;
}

export function makeHostResourceMonitorLive(
  options?: HostResourceMonitorOptions,
) {
  const intervalMs = options?.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;

  return Layer.effect(
    HostResourceMonitor,
    Effect.gen(function* () {
      const sampler = yield* ResourceSampler;
      const evaluator = yield* ThresholdEvaluator;
      const pubsub = yield* PubSub.unbounded<HostResourceStreamEvent>();
      const latestSnapshot = yield* Ref.make<HostResourceSnapshot | null>(null);

      const sampleAndPublish = (workspacePath: string) =>
        Effect.gen(function* () {
          const raw = yield* sampler.collectSample(workspacePath);
          const result = yield* evaluator.evaluate(raw, workspacePath);

          yield* Ref.set(latestSnapshot, result.snapshot);

          for (const transition of result.transitions) {
            yield* PubSub.publish(pubsub, {
              version: 1 as const,
              type: "transition" as const,
              metric: transition.metric,
              previousState: transition.previousState,
              currentState: transition.currentState,
              data: result.snapshot,
            });
          }
        });

      return {
        subscribe: (workspacePath: string) => {
          // Immediate sample to produce the initial snapshot event
          const initialSnapshot = Effect.gen(function* () {
            const raw = yield* sampler.collectSample(workspacePath);
            const result = yield* evaluator.evaluate(raw, workspacePath);
            yield* Ref.set(latestSnapshot, result.snapshot);
            return {
              version: 1 as const,
              type: "snapshot" as const,
              data: result.snapshot,
            } satisfies HostResourceStreamEvent;
          });

          const liveStream = Stream.fromPubSub(pubsub);

          return Stream.unwrap(
            Effect.gen(function* () {
              const snapshotEvent = yield* initialSnapshot;

              // Fork the background sample loop — cleaned up when scope closes
              yield* sampleAndPublish(workspacePath).pipe(
                Effect.repeat(Schedule.spaced(intervalMs)),
                Effect.forkScoped,
              );

              return Stream.concat(Stream.make(snapshotEvent), liveStream);
            }),
          );
        },
      };
    }),
  );
}

export const HostResourceMonitorLive = makeHostResourceMonitorLive();
