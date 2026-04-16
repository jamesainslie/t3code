import { Slider } from "../../ui/slider";
import { Input } from "../../ui/input";

interface FontSizeControlProps {
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
}

export function FontSizeControl({ value, onChange, min, max, step = 1 }: FontSizeControlProps) {
  const numericValue = Math.min(max, Math.max(min, Number.parseFloat(value) || min));

  const handleSliderChange = (v: number) => {
    onChange(`${v}px`);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number.parseFloat(e.target.value);
    if (!Number.isNaN(raw)) {
      const clamped = Math.min(max, Math.max(min, raw));
      onChange(`${clamped}px`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Slider
        value={numericValue}
        onChange={handleSliderChange}
        min={min}
        max={max}
        step={step}
        className="w-24"
      />
      <Input
        nativeInput
        size="sm"
        type="number"
        value={numericValue}
        onChange={handleInputChange}
        min={min}
        max={max}
        step={step}
        className="w-18"
      />
    </div>
  );
}
