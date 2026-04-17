import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { COLOR_SECTIONS } from "./colorSections";
import { ColorTokenRow } from "./ColorTokenRow";

export function ColorsPanel() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(COLOR_SECTIONS.map((s) => s.id)));

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {COLOR_SECTIONS.map((section) => {
        const isExpanded = expanded.has(section.id);
        return (
          <div key={section.id} className="rounded-lg border border-border">
            <button
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/50"
            >
              {isExpanded ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
              {section.title}
              <span className="text-xs text-muted-foreground">({section.tokens.length})</span>
            </button>
            {isExpanded && (
              <div className="border-t border-border px-3 pb-2">
                {section.tokens.map((token) => (
                  <ColorTokenRow key={token.key} tokenKey={token.key} label={token.label} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
