import { RotateCcwIcon } from "lucide-react";
import { ColorPicker } from "../../ui/color-picker";
import { Button } from "../../ui/button";
import { themeStore } from "../../../theme";
import { useTheme } from "../../../hooks/useTheme";
import type { ColorTokens } from "@t3tools/contracts";

interface ColorTokenRowProps {
  tokenKey: keyof ColorTokens;
  label: string;
}

export function ColorTokenRow({ tokenKey, label }: ColorTokenRowProps) {
  const { themeSnapshot } = useTheme();
  const currentValue = themeSnapshot.resolved.colors[tokenKey];
  const isOverridden = themeStore.isColorTokenOverridden(tokenKey);

  const handleChange = (color: string) => {
    themeStore.setColorToken(tokenKey, color);
  };

  const handleReset = () => {
    themeStore.resetColorToken(tokenKey);
  };

  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        {isOverridden && <div className="size-1.5 rounded-full bg-primary" title="Customized" />}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ColorPicker value={currentValue} onChange={handleChange} />
        {isOverridden && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleReset}
            title="Reset to default"
          >
            <RotateCcwIcon className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
