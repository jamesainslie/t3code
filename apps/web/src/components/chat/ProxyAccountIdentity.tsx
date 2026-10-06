import type { ProviderDriverKind } from "@t3tools/contracts";

import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Fork-only: who a gateway row belongs to, in the room a narrow card leaves.
 * The provider's icon says which service, the name is cut to its local part
 * and truncated, and hovering shows the whole account name.
 */
export function ProxyAccountIdentity({
  id,
  driver,
}: {
  readonly id: string;
  readonly driver: string;
}) {
  // `claude-1@ainslies.us` reads as `claude-1`: the domain is the same on
  // every row of one gateway and is what truncation would keep least of.
  const short = id.includes("@") ? id.slice(0, id.indexOf("@")) : id;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex min-w-0 items-center gap-1.5" aria-label={id} tabIndex={0} />}
      >
        <ProviderInstanceIcon
          driverKind={driver as ProviderDriverKind}
          displayName={id}
          indicatorBackground="var(--popover)"
          className="size-4"
          iconClassName="size-3.5 text-foreground/80"
        />
        <span className="truncate font-medium text-foreground">{short}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{id}</TooltipPopup>
    </Tooltip>
  );
}
