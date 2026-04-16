import { Slider } from "../../ui/slider";
import { Input } from "../../ui/input";

interface LineHeightControlProps {
  value: string;
  onChange: (value: string) => void;
}

export function LineHeightControl({ value, onChange }: LineHeightControlProps) {
  const numericValue = Math.min(2.0, Math.max(1.0, Number.parseFloat(value) || 1.5));

  const handleSliderChange = (v: number) => {
    onChange(v.toFixed(2));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number.parseFloat(e.target.value);
    if (!Number.isNaN(raw)) {
      const clamped = Math.min(2.0, Math.max(1.0, raw));
      onChange(clamped.toFixed(2));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Slider
        value={numericValue}
        onChange={handleSliderChange}
        min={1.0}
        max={2.0}
        step={0.05}
        className="w-24"
      />
      <Input
        nativeInput
        size="sm"
        type="number"
        value={numericValue}
        onChange={handleInputChange}
        min={1.0}
        max={2.0}
        step={0.05}
        className="w-18"
      />
    </div>
  );
}
