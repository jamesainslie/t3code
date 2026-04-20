import type { HostResourceSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatBytes, formatPercent, ResourceDetailContent } from "../ResourceDetailPopover";
import { ResourceMetricRow } from "../ResourceMetricRow";

// ─── Helpers ────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<HostResourceSnapshot> = {}): HostResourceSnapshot {
  return {
    ram: {
      state: "normal",
      usagePercent: 55,
      totalBytes: 32e9,
      usedBytes: 17.8e9,
      availableBytes: 14.2e9,
      swapUsedBytes: 2.1e9,
      swapTotalBytes: 8e9,
    },
    cpu: {
      state: "normal",
      usagePercent: 12,
      coreCount: 10,
      sustainedPercent: 11,
    },
    disk: {
      state: "normal",
      usagePercent: 45,
      totalBytes: 1e12,
      usedBytes: 450e9,
      availableBytes: 550e9,
      mountPath: "/",
    },
    containers: null,
    kubecontext: null,
    remote: {
      isRemote: false,
      hostname: "macbook.local",
      fqdn: "macbook.local",
      isRoot: false,
    },
    ...overrides,
  };
}

function renderContent(snapshot: HostResourceSnapshot): string {
  return renderToStaticMarkup(<ResourceDetailContent snapshot={snapshot} />);
}

// ─── Formatting Helpers ─────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats terabytes", () => {
    expect(formatBytes(1e12)).toBe("1.0 TB");
    expect(formatBytes(2.5e12)).toBe("2.5 TB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(32e9)).toBe("32.0 GB");
    expect(formatBytes(14.2e9)).toBe("14.2 GB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(512e6)).toBe("512.0 MB");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1500)).toBe("1.5 KB");
  });
});

describe("formatPercent", () => {
  it("rounds to nearest integer with percent sign", () => {
    expect(formatPercent(12.4)).toBe("12%");
    expect(formatPercent(85.7)).toBe("86%");
    expect(formatPercent(0)).toBe("0%");
  });
});

// ─── ResourceMetricRow ──────────────────────────────────────────────

describe("ResourceMetricRow", () => {
  it("renders label and summary", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow label="RAM" state="normal" summary="14.2 GB free" />,
    );
    expect(html).toContain("RAM");
    expect(html).toContain("14.2 GB free");
  });

  it("renders a progress bar when usagePercent is provided", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow label="RAM" state="normal" summary="14.2 GB free" usagePercent={55} />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="55"');
  });

  it("does not render a progress bar when usagePercent is omitted", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow label="Host" state="normal" summary="macbook.local" />,
    );
    expect(html).not.toContain('role="progressbar"');
  });

  it("renders detail children when defaultExpanded is true", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow
        label="RAM"
        state="critical"
        summary="1.2 GB free"
        usagePercent={96}
        defaultExpanded={true}
      >
        <div data-testid="detail-row">Total: 32.0 GB</div>
      </ResourceMetricRow>,
    );
    expect(html).toContain("Total: 32.0 GB");
  });

  it("hides detail children when defaultExpanded is false", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow
        label="RAM"
        state="normal"
        summary="14.2 GB free"
        usagePercent={55}
        defaultExpanded={false}
      >
        <div>Total: 32.0 GB</div>
      </ResourceMetricRow>,
    );
    expect(html).not.toContain("Total: 32.0 GB");
  });

  it("applies warn color to the state dot for warn state", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow label="RAM" state="warn" summary="5.0 GB free" usagePercent={84} />,
    );
    expect(html).toContain("bg-amber-500");
  });

  it("applies critical color to the state dot for critical state", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow label="CPU" state="critical" summary="97%" usagePercent={97} />,
    );
    expect(html).toContain("bg-red-500");
  });

  it("applies normal color to the state dot for normal state", () => {
    const html = renderToStaticMarkup(
      <ResourceMetricRow label="Disk" state="normal" summary="550.0 GB free" usagePercent={45} />,
    );
    expect(html).toContain("bg-emerald-500");
  });
});

// ─── ResourceDetailContent (popover body) ──────────────────────────

describe("ResourceDetailContent", () => {
  it("always renders RAM, CPU, Disk, and Host metric rows", () => {
    const html = renderContent(makeSnapshot());
    expect(html).toContain("RAM");
    expect(html).toContain("CPU");
    expect(html).toContain("Disk");
    expect(html).toContain("Host");
  });

  it("renders usage bars for RAM, CPU, and Disk", () => {
    const html = renderContent(makeSnapshot());
    // Three progressbar elements for RAM, CPU, Disk
    const progressbars = html.match(/role="progressbar"/g);
    expect(progressbars).toHaveLength(3);
  });

  it("does not render Containers row when containers is null", () => {
    const html = renderContent(makeSnapshot({ containers: null }));
    expect(html).not.toContain("Containers");
  });

  it("renders Containers row when containers is present", () => {
    const html = renderContent(
      makeSnapshot({
        containers: {
          state: "normal",
          running: 3,
          stopped: 1,
          total: 4,
        },
      }),
    );
    expect(html).toContain("Containers");
    expect(html).toContain("3 running");
  });

  it("does not render Kubernetes row when kubecontext is null", () => {
    const html = renderContent(makeSnapshot({ kubecontext: null }));
    expect(html).not.toContain("Kubernetes");
  });

  it("renders Kubernetes row when kubecontext is present", () => {
    const html = renderContent(
      makeSnapshot({
        kubecontext: {
          state: "normal",
          context: "dev-eastus-core",
          cluster: "https://dev.example.com",
          namespace: "default",
          isDanger: false,
          dangerReason: null,
        },
      }),
    );
    expect(html).toContain("Kubernetes");
    expect(html).toContain("dev-eastus-core");
  });

  it("shows PRODUCTION CONTEXT danger banner when kubecontext.isDanger is true", () => {
    const html = renderContent(
      makeSnapshot({
        kubecontext: {
          state: "critical",
          context: "pd-eastus-core",
          cluster: "https://pd.example.com",
          namespace: "default",
          isDanger: true,
          dangerReason: "matches pd-",
        },
      }),
    );
    expect(html).toContain("PRODUCTION CONTEXT");
    expect(html).toContain("bg-red-500/10");
  });

  it("shows ROOT SESSION danger banner when remote.isRoot is true", () => {
    const html = renderContent(
      makeSnapshot({
        remote: {
          isRemote: true,
          hostname: "server.local",
          fqdn: "server.local",
          isRoot: true,
        },
      }),
    );
    expect(html).toContain("ROOT SESSION");
    expect(html).toContain("bg-red-500/10");
  });

  it("shows both danger banners when both conditions are true", () => {
    const html = renderContent(
      makeSnapshot({
        kubecontext: {
          state: "critical",
          context: "pd-eastus-core",
          cluster: "https://pd.example.com",
          namespace: "default",
          isDanger: true,
          dangerReason: "matches pd-",
        },
        remote: {
          isRemote: true,
          hostname: "server.local",
          fqdn: "server.local",
          isRoot: true,
        },
      }),
    );
    expect(html).toContain("PRODUCTION CONTEXT");
    expect(html).toContain("ROOT SESSION");
  });

  it("renders RAM detail values", () => {
    const html = renderContent(makeSnapshot());
    // RAM summary should show available
    expect(html).toContain("14.2 GB free");
  });

  it("renders CPU summary with usage percent", () => {
    const html = renderContent(makeSnapshot());
    expect(html).toContain("12%");
  });

  it("renders Disk summary with available space", () => {
    const html = renderContent(makeSnapshot());
    expect(html).toContain("550.0 GB free");
  });

  it("renders Host summary with hostname", () => {
    const html = renderContent(makeSnapshot());
    expect(html).toContain("macbook.local");
  });

  it("renders remote indicator for remote hosts", () => {
    const html = renderContent(
      makeSnapshot({
        remote: {
          isRemote: true,
          hostname: "server.prod",
          fqdn: "server.prod.example.com",
          isRoot: false,
        },
      }),
    );
    expect(html).toContain("server.prod");
  });
});
