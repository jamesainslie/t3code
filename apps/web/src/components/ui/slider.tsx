"use client";

import * as React from "react";

import { cn } from "~/lib/utils";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  disabled = false,
}: SliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  return (
    <input
      type="range"
      value={value}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      data-slot="slider"
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary",
        "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
        "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    />
  );
}

export { Slider, type SliderProps };
