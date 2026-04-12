import { Effect, Layer } from "effect";

import { ResourceSampler, type ResourceSamplerShape } from "../Services/ResourceSampler.ts";
import { sampleRam } from "../Samplers/RamSampler.ts";
import { makeCpuSampler } from "../Samplers/CpuSampler.ts";
import { sampleDisk } from "../Samplers/DiskSampler.ts";
import { sampleDocker } from "../Samplers/DockerSampler.ts";
import { sampleKubecontext } from "../Samplers/KubecontextSampler.ts";
import { sampleRemote } from "../Samplers/RemoteSampler.ts";

export const ResourceSamplerLive = Layer.effect(
  ResourceSampler,
  Effect.gen(function* () {
    const cpuSampler = yield* makeCpuSampler();

    return {
      collectSample: (workspacePath: string) =>
        Effect.all({
          ram: sampleRam,
          cpu: cpuSampler.sample,
          disk: sampleDisk(workspacePath),
          containers: sampleDocker,
          kubecontext: sampleKubecontext,
          remote: sampleRemote,
        }),
    } satisfies ResourceSamplerShape;
  }),
);
