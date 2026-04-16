import { RotateCcwIcon } from "lucide-react";
import { Button } from "../../ui/button";
import { themeStore } from "../../../theme";
import { useTheme } from "../../../hooks/useTheme";
import type { TypographyTokens } from "@t3tools/contracts";

interface TypographyTokenRowProps {
  tokenKey: keyof TypographyTokens;
  label: string;
  children: React.ReactNode;
}

export function TypographyTokenRow({ tokenKey, label, children }: TypographyTokenRowProps) {
  useTheme(); // subscribe to re-render on snapshot changes
  const isOverridden = themeStore.isTypographyTokenOverridden(tokenKey);

  const handleReset = () => {
    themeStore.resetTypographyToken(tokenKey);
  };

  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        {isOverridden && (
          <div className="size-1.5 rounded-full bg-primary" title="Customized" />
        )}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {children}
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
