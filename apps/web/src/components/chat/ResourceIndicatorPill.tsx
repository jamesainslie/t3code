import { memo } from "react";
import type { HostResourceSnapshot } from "@t3tools/contracts";
import { ResourceCollapsedDot } from "./ResourceCollapsedDot";
import { ResourceIndicatorStrip } from "./ResourceIndicatorStrip";
import { ResourceDetailPopover } from "./ResourceDetailPopover";

export const ResourceIndicatorPill = memo(function ResourceIndicatorPill({
  snapshot,
}: {
  snapshot: HostResourceSnapshot | null;
}) {
  if (!snapshot) return null;

  return (
    <ResourceDetailPopover snapshot={snapshot}>
      {/* Full strip visible at @3xl of the header-actions container */}
      <div className="hidden @3xl/header-actions:block">
        <ResourceIndicatorStrip snapshot={snapshot} />
      </div>
      {/* Collapsed dot visible below @3xl */}
      <div className="block @3xl/header-actions:hidden">
        <ResourceCollapsedDot snapshot={snapshot} />
      </div>
    </ResourceDetailPopover>
  );
});
