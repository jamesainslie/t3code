"use client";

import * as React from "react";

import { cn } from "~/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Attempt to parse any CSS color value into a hex string for the native
 * <input type="color"> element, which requires a 6-digit hex value.
 * Returns null when the color cannot be resolved in this environment.
 */
function toHexColor(color: string): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/) ?? [];
    if (r && g && b) {
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
  }
  return null;
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

function ColorPicker({ value, onChange, className, disabled = false }: ColorPickerProps) {
  const hexForInput = toHexColor(value) ?? "#000000";

  // Local hex text state — synced from value prop, independently editable
  const [hexText, setHexText] = React.useState<string>(value);

  // Keep hex text in sync when value changes externally
  React.useEffect(() => {
    setHexText(value);
  }, [value]);

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    onChange(hex);
    setHexText(hex);
  };

  const handleHexTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHexText(e.target.value);
  };

  const handleHexTextBlur = () => {
    if (isValidHex(hexText)) {
      onChange(hexText.toLowerCase());
    } else {
      // Revert to the current value if invalid
      setHexText(value);
    }
  };

  const handleHexTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (isValidHex(hexText)) {
        onChange(hexText.toLowerCase());
      } else {
        setHexText(value);
      }
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        data-slot="color-picker-trigger"
        className={cn(
          "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input shadow-xs/5 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <span
          className="size-5 rounded"
          style={{ background: value }}
          data-slot="color-picker-swatch"
        />
        <span className="sr-only">Pick color</span>
      </PopoverTrigger>

      <PopoverContent side="bottom" align="start" className="w-auto" data-slot="color-picker-popup">
        <div className="flex flex-col gap-3">
          <input
            type="color"
            value={hexForInput}
            onChange={handleNativeChange}
            disabled={disabled}
            data-slot="color-picker-native"
            className="h-32 w-full cursor-pointer rounded border-0 bg-transparent p-0 outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-muted-foreground text-xs">#</span>
            <input
              type="text"
              value={hexText.startsWith("#") ? hexText.slice(1) : hexText}
              onChange={(e) =>
                handleHexTextChange({
                  ...e,
                  target: { ...e.target, value: `#${e.target.value}` },
                } as React.ChangeEvent<HTMLInputElement>)
              }
              onBlur={handleHexTextBlur}
              onKeyDown={handleHexTextKeyDown}
              maxLength={6}
              disabled={disabled}
              placeholder="rrggbb"
              data-slot="color-picker-hex-input"
              className="h-7 w-full min-w-0 rounded border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { ColorPicker, type ColorPickerProps };
