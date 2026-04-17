import { CheckIcon } from "lucide-react";
import type { IconSetManifest } from "@t3tools/contracts";
import { cn } from "../../../lib/utils";

interface IconSetCardProps {
  manifest: IconSetManifest;
  isSelected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export function IconSetCard({
  manifest,
  isSelected,
  onSelect,
  disabled = false,
}: IconSetCardProps) {
  const previewIcons = manifest.previewIcons ?? [];

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {/* Selected check */}
      {isSelected && (
        <div className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary">
          <CheckIcon className="size-3 text-primary-foreground" />
        </div>
      )}

      {/* Name + badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{manifest.name}</span>
        {disabled && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Coming soon
          </span>
        )}
      </div>

      {/* Description */}
      {manifest.description && (
        <p className="text-xs text-muted-foreground">{manifest.description}</p>
      )}

      {/* Preview icons */}
      <div className="flex flex-wrap gap-1">
        {disabled ? (
          <span className="text-xs text-muted-foreground/50">No preview available</span>
        ) : (
          previewIcons.slice(0, 8).map((name) => (
            <span
              key={name}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {name}
            </span>
          ))
        )}
      </div>
    </button>
  );
}
