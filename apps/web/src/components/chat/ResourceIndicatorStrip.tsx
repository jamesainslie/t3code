import type { HostResourceSnapshot, MetricState } from "@t3tools/contracts";
import { Container, Cpu, Globe, HardDrive, MemoryStick, Ship } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "~/lib/utils";

export interface ResourceIndicatorStripProps {
  snapshot: HostResourceSnapshot | null;
}

function getMetricColorClass(state: MetricState): string {
  switch (state) {
    case "normal":
      return "text-muted-foreground/50";
    case "warn":
      return "text-amber-500";
    case "critical":
      return "text-red-500 animate-pulse-slow";
  }
}

interface IndicatorIconProps {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  colorClass: string;
}

function IndicatorIcon({ label, icon: Icon, colorClass }: IndicatorIconProps) {
  return (
    <span aria-label={label} className={cn("size-4 shrink-0", colorClass)}>
      <Icon className="size-full" />
    </span>
  );
}

export function ResourceIndicatorStrip({ snapshot }: ResourceIndicatorStripProps) {
  if (snapshot === null) {
    return null;
  }

  const remoteState: MetricState = snapshot.remote.isRoot ? "critical" : "normal";

  const kubeState: MetricState = snapshot.kubecontext?.isDanger
    ? "critical"
    : (snapshot.kubecontext?.state ?? "normal");

  return (
    <div
      role="group"
      aria-label="System resources"
      className="flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-2 py-1"
    >
      <IndicatorIcon
        label="RAM"
        icon={MemoryStick}
        colorClass={getMetricColorClass(snapshot.ram.state)}
      />
      <IndicatorIcon label="CPU" icon={Cpu} colorClass={getMetricColorClass(snapshot.cpu.state)} />
      <IndicatorIcon
        label="Disk"
        icon={HardDrive}
        colorClass={getMetricColorClass(snapshot.disk.state)}
      />
      {snapshot.containers !== null && (
        <IndicatorIcon
          label="Containers"
          icon={Container}
          colorClass={getMetricColorClass(snapshot.containers.state)}
        />
      )}
      {snapshot.kubecontext !== null && (
        <IndicatorIcon label="Kubernetes" icon={Ship} colorClass={getMetricColorClass(kubeState)} />
      )}
      <IndicatorIcon label="Host" icon={Globe} colorClass={getMetricColorClass(remoteState)} />
    </div>
  );
}
