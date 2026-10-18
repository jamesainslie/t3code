import type { IsoDate } from "@lathe/contracts";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { weekStartsOn } from "~/timestampFormat";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { localIsoDate } from "./roadmap.logic";
import { formatRoadmapDate } from "./roadmapPage.logic";

const dateOf = (iso: IsoDate) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};

/**
 * A due date control. `inline` is the compact trigger for an Outline cell;
 * `field` fills a form column.
 */
export function RoadmapDuePicker({
  value,
  today,
  disabled = false,
  appearance,
  label,
  onChange,
}: {
  readonly value: IsoDate | null;
  readonly today: IsoDate;
  readonly disabled?: boolean;
  readonly appearance: "inline" | "field";
  readonly label: string;
  readonly onChange: (next: IsoDate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value === null ? undefined : dateOf(value);
  const text = value === null ? "None" : formatRoadmapDate(value, today);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={`${label}: ${text}`}
        render={
          appearance === "inline" ? (
            <Button size="micro" variant="ghost-muted" />
          ) : (
            <Button variant="outline" className="w-full justify-between" />
          )
        }
      >
        {text}
        {appearance === "field" ? <CalendarIcon /> : null}
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label={label}>
        <div className="flex flex-col gap-2">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? dateOf(today)}
            {...(weekStartsOn === undefined ? {} : { weekStartsOn })}
            onSelect={(date: Date | undefined) => {
              setOpen(false);
              onChange(date === undefined ? null : localIsoDate(date));
            }}
          />
          {value !== null ? (
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => {
                setOpen(false);
                onChange(null);
              }}
            >
              Clear date
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function RoadmapEstimateField({
  value,
  label,
  onChange,
}: {
  readonly value: number | null;
  readonly label: string;
  readonly onChange: (next: number | null) => void;
}) {
  return (
    <NumberField
      aria-label={label}
      min={0}
      step={1}
      value={value}
      onValueChange={(next) => onChange(next === null || Number.isNaN(next) ? null : next)}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement />
        <NumberFieldInput placeholder="None" />
        <NumberFieldIncrement />
      </NumberFieldGroup>
    </NumberField>
  );
}

/** The Outline's estimate cell: a compact trigger that edits in a popover and saves on close. */
export function RoadmapEstimatePicker({
  value,
  disabled = false,
  label,
  onChange,
}: {
  readonly value: number | null;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (next: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value);
        else if (draft !== value) onChange(draft);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={`${label}: ${value === null ? "None" : value}`}
        render={<Button size="micro" variant="ghost-muted" />}
      >
        {value === null ? "None" : String(value)}
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label={label}>
        <div className="w-40">
          <RoadmapEstimateField value={draft} label={label} onChange={setDraft} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
