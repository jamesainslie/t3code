import type {
  CpuMetric,
  HostResourceSnapshot,
  MetricState,
  RamMetric,
  RemoteMetric,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResourceIndicatorStrip } from "../ResourceIndicatorStrip";

const BASE_RAM: RamMetric = {
  state: "normal",
  usagePercent: 50,
  totalBytes: 32e9,
  usedBytes: 16e9,
  availableBytes: 16e9,
  swapUsedBytes: 0,
  swapTotalBytes: 0,
} as RamMetric;

const BASE_CPU: CpuMetric = {
  state: "normal",
  usagePercent: 10,
  coreCount: 10,
  sustainedPercent: 10,
} as CpuMetric;

const BASE_DISK = {
  state: "normal" as MetricState,
  usagePercent: 30,
  totalBytes: 1e12,
  usedBytes: 3e11,
  availableBytes: 7e11,
  mountPath: "/",
};

const BASE_REMOTE: RemoteMetric = {
  isRemote: false,
  hostname: "test",
  fqdn: "test.local",
  isRoot: false,
} as RemoteMetric;

function makeSnapshot(
  overrides?: Partial<{
    ram: RamMetric;
    cpu: CpuMetric;
    disk: typeof BASE_DISK;
    containers: HostResourceSnapshot["containers"];
    kubecontext: HostResourceSnapshot["kubecontext"];
    remote: RemoteMetric;
  }>,
): HostResourceSnapshot {
  return {
    ram: overrides?.ram ?? BASE_RAM,
    cpu: overrides?.cpu ?? BASE_CPU,
    disk: overrides?.disk ?? BASE_DISK,
    containers: overrides?.containers ?? null,
    kubecontext: overrides?.kubecontext ?? null,
    remote: overrides?.remote ?? BASE_REMOTE,
  } as HostResourceSnapshot;
}

describe("ResourceIndicatorStrip", () => {
  it("renders nothing when snapshot is null", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip snapshot={null} />,
    );
    expect(markup).toBe("");
  });

  it("renders RAM, CPU, Disk, and Host icons for basic snapshot", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip snapshot={makeSnapshot()} />,
    );
    expect(markup).toContain('aria-label="RAM"');
    expect(markup).toContain('aria-label="CPU"');
    expect(markup).toContain('aria-label="Disk"');
    expect(markup).toContain('aria-label="Host"');
    expect(markup).not.toContain('aria-label="Containers"');
    expect(markup).not.toContain('aria-label="Kubernetes"');
  });

  it("renders the pill container with correct role and label", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip snapshot={makeSnapshot()} />,
    );
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="System resources"');
  });

  it("shows Containers icon when containers data is present", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip
        snapshot={makeSnapshot({
          containers: {
            state: "normal",
            running: 3,
            stopped: 0,
            total: 3,
          } as HostResourceSnapshot["containers"],
        })}
      />,
    );
    expect(markup).toContain('aria-label="Containers"');
  });

  it("shows Kubernetes icon when kubecontext is present", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip
        snapshot={makeSnapshot({
          kubecontext: {
            state: "normal",
            context: "dev",
            cluster: "dev-cluster",
            namespace: "default",
            isDanger: false,
            dangerReason: null,
          } as HostResourceSnapshot["kubecontext"],
        })}
      />,
    );
    expect(markup).toContain('aria-label="Kubernetes"');
  });

  it("applies warn color class for warn state", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip
        snapshot={makeSnapshot({
          ram: { ...BASE_RAM, state: "warn" },
        })}
      />,
    );
    const ramMatch = markup.match(
      /aria-label="RAM"[^>]*class="([^"]*)"/,
    );
    expect(ramMatch).not.toBeNull();
    expect(ramMatch![1]).toContain("text-amber-500");
  });

  it("applies critical color class for critical state", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip
        snapshot={makeSnapshot({
          cpu: { ...BASE_CPU, state: "critical" },
        })}
      />,
    );
    const cpuMatch = markup.match(
      /aria-label="CPU"[^>]*class="([^"]*)"/,
    );
    expect(cpuMatch).not.toBeNull();
    expect(cpuMatch![1]).toContain("text-red-500");
  });

  it("applies normal color class for normal state", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip snapshot={makeSnapshot()} />,
    );
    const ramMatch = markup.match(
      /aria-label="RAM"[^>]*class="([^"]*)"/,
    );
    expect(ramMatch).not.toBeNull();
    expect(ramMatch![1]).toContain("text-muted-foreground/50");
  });

  it("forces critical on Host icon when remote.isRoot is true", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip
        snapshot={makeSnapshot({
          remote: { ...BASE_REMOTE, isRoot: true },
        })}
      />,
    );
    const hostMatch = markup.match(
      /aria-label="Host"[^>]*class="([^"]*)"/,
    );
    expect(hostMatch).not.toBeNull();
    expect(hostMatch![1]).toContain("text-red-500");
  });

  it("forces critical on Kubernetes icon when isDanger is true", () => {
    const markup = renderToStaticMarkup(
      <ResourceIndicatorStrip
        snapshot={makeSnapshot({
          kubecontext: {
            state: "normal",
            context: "prod-us-east",
            cluster: "prod-cluster",
            namespace: "default",
            isDanger: true,
            dangerReason: "production context",
          } as HostResourceSnapshot["kubecontext"],
        })}
      />,
    );
    const kubeMatch = markup.match(
      /aria-label="Kubernetes"[^>]*class="([^"]*)"/,
    );
    expect(kubeMatch).not.toBeNull();
    expect(kubeMatch![1]).toContain("text-red-500");
  });
});
