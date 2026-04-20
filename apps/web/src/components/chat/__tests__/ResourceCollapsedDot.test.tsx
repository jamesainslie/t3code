import type {
  CpuMetric,
  HostResourceSnapshot,
  MetricState,
  RamMetric,
  RemoteMetric,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResourceCollapsedDot } from "../ResourceCollapsedDot";

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

describe("ResourceCollapsedDot", () => {
  it("renders with normal state color when all metrics normal", () => {
    const html = renderToStaticMarkup(
      <ResourceCollapsedDot snapshot={makeSnapshot()} />,
    );
    expect(html).toContain('aria-label="System resources"');
    expect(html).toContain("text-muted-foreground/50");
  });

  it("renders amber when worst state is warn", () => {
    const html = renderToStaticMarkup(
      <ResourceCollapsedDot
        snapshot={makeSnapshot({ ram: { ...BASE_RAM, state: "warn" } })}
      />,
    );
    expect(html).toContain("text-amber-500");
  });

  it("renders red with pulse when worst state is critical", () => {
    const html = renderToStaticMarkup(
      <ResourceCollapsedDot
        snapshot={makeSnapshot({ cpu: { ...BASE_CPU, state: "critical" } })}
      />,
    );
    expect(html).toContain("text-red-500");
    expect(html).toContain("animate-pulse-slow");
  });

  it("renders red when root user", () => {
    const html = renderToStaticMarkup(
      <ResourceCollapsedDot
        snapshot={makeSnapshot({ remote: { ...BASE_REMOTE, isRoot: true } })}
      />,
    );
    expect(html).toContain("text-red-500");
  });
});
