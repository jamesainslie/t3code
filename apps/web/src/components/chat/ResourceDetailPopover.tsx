import type { HostResourceSnapshot } from "@t3tools/contracts";
import { Cpu, Globe, HardDrive, MemoryStick, Ship, Container } from "lucide-react";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";

import { DetailKV, ResourceMetricRow } from "./ResourceMetricRow";

// ─── Props ──────────────────────────────────────────────────────────

export interface ResourceDetailPopoverProps {
  snapshot: HostResourceSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactElement;
}

// ─── Formatting Helpers ─────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

export function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

// ─── Danger Banner ──────────────────────────────────────────────────

function DangerBanner({ message }: { message: string }) {
  return (
    <div className="border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-500">
      {"\u26a0"} {message}
    </div>
  );
}

// ─── Popover Body (testable without Portal) ────────────────────────

export function ResourceDetailContent({ snapshot }: { snapshot: HostResourceSnapshot }) {
  const { ram, cpu, disk, containers, kubecontext, remote } = snapshot;

  const kubeDanger = kubecontext?.isDanger ?? false;
  const rootDanger = remote.isRoot;

  return (
    <div className="w-80 divide-y divide-border">
      {/* Danger banners */}
      {kubeDanger && <DangerBanner message="PRODUCTION CONTEXT" />}
      {rootDanger && <DangerBanner message="ROOT SESSION" />}

      {/* RAM */}
      <ResourceMetricRow
        label="RAM"
        icon={MemoryStick}
        state={ram.state}
        summary={`${formatBytes(ram.availableBytes)} free`}
        usagePercent={ram.usagePercent}
        defaultExpanded={ram.state === "critical"}
      >
        <DetailKV label="Total" value={formatBytes(ram.totalBytes)} />
        <DetailKV label="Used" value={formatBytes(ram.usedBytes)} />
        <DetailKV label="Available" value={formatBytes(ram.availableBytes)} />
        <DetailKV
          label="Swap"
          value={`${formatBytes(ram.swapUsedBytes)} / ${formatBytes(ram.swapTotalBytes)}`}
        />
      </ResourceMetricRow>

      {/* CPU */}
      <ResourceMetricRow
        label="CPU"
        icon={Cpu}
        state={cpu.state}
        summary={formatPercent(cpu.usagePercent)}
        usagePercent={cpu.usagePercent}
        defaultExpanded={cpu.state === "critical"}
      >
        <DetailKV label="Usage" value={formatPercent(cpu.usagePercent)} />
        <DetailKV label="Sustained" value={formatPercent(cpu.sustainedPercent)} />
        <DetailKV label="Cores" value={String(cpu.coreCount)} />
      </ResourceMetricRow>

      {/* Disk */}
      <ResourceMetricRow
        label="Disk"
        icon={HardDrive}
        state={disk.state}
        summary={`${formatBytes(disk.availableBytes)} free`}
        usagePercent={disk.usagePercent}
        defaultExpanded={disk.state === "critical"}
      >
        <DetailKV label="Total" value={formatBytes(disk.totalBytes)} />
        <DetailKV label="Used" value={formatBytes(disk.usedBytes)} />
        <DetailKV label="Available" value={formatBytes(disk.availableBytes)} />
        <DetailKV label="Mount" value={disk.mountPath} />
      </ResourceMetricRow>

      {/* Containers (conditional) */}
      {containers && (
        <ResourceMetricRow
          label="Containers"
          icon={Container}
          state={containers.state}
          summary={`${containers.running} running`}
          defaultExpanded={containers.state === "critical"}
        >
          <DetailKV label="Running" value={String(containers.running)} />
          <DetailKV label="Stopped" value={String(containers.stopped)} />
          <DetailKV label="Total" value={String(containers.total)} />
        </ResourceMetricRow>
      )}

      {/* Kubernetes (conditional) */}
      {kubecontext && (
        <ResourceMetricRow
          label="Kubernetes"
          icon={Ship}
          state={kubecontext.state}
          summary={kubecontext.context}
          defaultExpanded={kubeDanger}
        >
          <DetailKV label="Context" value={kubecontext.context} />
          <DetailKV label="Cluster" value={kubecontext.cluster} />
          <DetailKV label="Namespace" value={kubecontext.namespace} />
        </ResourceMetricRow>
      )}

      {/* Host */}
      <ResourceMetricRow
        label="Host"
        icon={Globe}
        state={rootDanger ? "critical" : "normal"}
        summary={remote.hostname}
        defaultExpanded={rootDanger}
      >
        <DetailKV label="Hostname" value={remote.hostname} />
        <DetailKV label="FQDN" value={remote.fqdn} />
        <DetailKV label="Remote" value={remote.isRemote ? "Yes" : "No"} />
        <DetailKV label="Root" value={remote.isRoot ? "Yes" : "No"} />
      </ResourceMetricRow>
    </div>
  );
}

// ─── Popover Wrapper ────────────────────────────────────────────────

export function ResourceDetailPopover({
  snapshot,
  open,
  onOpenChange,
  children,
}: ResourceDetailPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={children} />
      <PopoverPopup side="bottom" align="center" sideOffset={8}>
        <ResourceDetailContent snapshot={snapshot} />
      </PopoverPopup>
    </Popover>
  );
}
