import type {
  CpuMetric,
  HostResourceSnapshot,
  MetricState,
  RamMetric,
  RemoteMetric,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResourceIndicatorPill } from "../ResourceIndicatorPill";

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

describe("ResourceIndicatorPill", () => {
  it("renders nothing when snapshot is null", () => {
    const markup = renderToStaticMarkup(<ResourceIndicatorPill snapshot={null} />);
    expect(markup).toBe("");
  });

  it("renders the trigger with a nested ResourceIndicatorStrip when snapshot is provided", () => {
    const markup = renderToStaticMarkup(<ResourceIndicatorPill snapshot={makeSnapshot()} />);
    expect(markup).not.toBe("");
    // The TooltipTrigger renders a <button> wrapper
    expect(markup).toMatch(/^<button/);
    // The ResourceIndicatorStrip should be rendered inside (indicated by the group role)
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="System resources"');
  });

  it("renders all metric icons from the underlying strip", () => {
    const markup = renderToStaticMarkup(<ResourceIndicatorPill snapshot={makeSnapshot()} />);
    expect(markup).toContain('aria-label="RAM"');
    expect(markup).toContain('aria-label="CPU"');
    expect(markup).toContain('aria-label="Disk"');
    expect(markup).toContain('aria-label="Host"');
  });
});
