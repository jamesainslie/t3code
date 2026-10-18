/**
 * Fork: roadmap. Snoozes a work item to a date: three presets, or a date from
 * the calendar. Shared by Today's rows and the Roadmap card.
 */
import type { IsoDate } from "@lathe/contracts";
import { addDays } from "@lathe/shared/roadmapCalc";
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

import { weekStartsOn } from "~/timestampFormat";
import { Calendar } from "../ui/calendar";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup } from "../ui/popover";
import { localIsoDate } from "./roadmap.logic";
import { roadmapSnoozeChoices } from "./roadmapToday.logic";

const dateOf = (iso: IsoDate) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};

export interface RoadmapSnoozeMenuProps {
  /** The user's local date; every choice lands after it. */
  readonly today: IsoDate;
  readonly onSnooze: (until: IsoDate) => void;
  /** Adds an Unsnooze entry; pass it only while the item is snoozed. */
  readonly onUnsnooze?: () => void;
  /** The trigger element, such as `<Button size="xs" variant="ghost-muted" />`. */
  readonly render: ReactElement;
  /** The trigger's content. */
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly align?: "start" | "center" | "end";
  /** True while the menu or the date picker is showing, for hosts that reveal it on hover. */
  readonly onOpenChange?: (open: boolean) => void;
}

export function RoadmapSnoozeMenu({
  today,
  onSnooze,
  onUnsnooze,
  render,
  children,
  disabled = false,
  align = "end",
  onOpenChange,
}: RoadmapSnoozeMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState(false);
  const choices = useMemo(() => roadmapSnoozeChoices(today), [today]);
  // "Pick a date" opens the picker in the same click that closes the menu, and
  // the two callbacks can arrive in either order, so both are tracked in a ref.
  const shown = useRef({ menu: false, picker: false });
  const show = (next: Partial<{ menu: boolean; picker: boolean }>) => {
    shown.current = { ...shown.current, ...next };
    onOpenChange?.(shown.current.menu || shown.current.picker);
  };
  const setPicker = (open: boolean) => {
    setPicking(open);
    show({ picker: open });
  };

  return (
    <>
      <Menu onOpenChange={(open) => show({ menu: open })}>
        <MenuTrigger ref={triggerRef} disabled={disabled} render={render}>
          {children}
        </MenuTrigger>
        <MenuPopup align={align}>
          {choices.map((choice) => (
            <MenuItem key={choice.id} onClick={() => onSnooze(choice.until)}>
              {choice.label}
              <MenuShortcut>{choice.hint}</MenuShortcut>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => setPicker(true)}>Pick a date…</MenuItem>
          {onUnsnooze === undefined ? null : <MenuItem onClick={onUnsnooze}>Unsnooze</MenuItem>}
        </MenuPopup>
      </Menu>
      <Popover open={picking} onOpenChange={setPicker}>
        <PopoverPopup anchor={triggerRef} align={align} aria-label="Snooze until">
          <Calendar
            mode="single"
            defaultMonth={dateOf(addDays(today, 1))}
            {...(weekStartsOn === undefined ? {} : { weekStartsOn })}
            disabled={{ before: dateOf(addDays(today, 1)) }}
            onSelect={(date: Date | undefined) => {
              setPicker(false);
              if (date !== undefined) onSnooze(localIsoDate(date));
            }}
          />
        </PopoverPopup>
      </Popover>
    </>
  );
}
