import { memo, useState, useRef, useCallback } from "react";
import type { HostResourceSnapshot } from "@t3tools/contracts";
import { ResourceCollapsedDot } from "./ResourceCollapsedDot";
import { ResourceIndicatorStrip } from "./ResourceIndicatorStrip";
import { ResourceDetailPopover } from "./ResourceDetailPopover";

const HOVER_DELAY_MS = 300;

export const ResourceIndicatorPill = memo(function ResourceIndicatorPill({
  snapshot,
}: {
  snapshot: HostResourceSnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setOpen(false);
  }, []);

  if (!snapshot) return null;

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <ResourceDetailPopover snapshot={snapshot} open={open} onOpenChange={setOpen}>
        <div>
          {/* Full strip visible at @3xl of the header-actions container */}
          <div className="hidden @3xl/header-actions:block">
            <ResourceIndicatorStrip snapshot={snapshot} />
          </div>
          {/* Collapsed dot visible below @3xl */}
          <div className="block @3xl/header-actions:hidden">
            <ResourceCollapsedDot snapshot={snapshot} />
          </div>
        </div>
      </ResourceDetailPopover>
    </div>
  );
});
