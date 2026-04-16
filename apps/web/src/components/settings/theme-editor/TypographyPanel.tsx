import { useTheme } from "../../../hooks/useTheme";
import { themeStore } from "../../../theme";
import { Input } from "../../ui/input";
import { TypographyTokenRow } from "./TypographyTokenRow";
import { FontSizeControl } from "./FontSizeControl";
import { LineHeightControl } from "./LineHeightControl";
import type { TypographyTokens } from "@t3tools/contracts";

function FontFamilyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      nativeInput
      size="sm"
      value={value}
      onChange={(e) => onChange((e.target as HTMLInputElement).value)}
      className="w-48"
      placeholder="Font family..."
    />
  );
}

export function TypographyPanel() {
  const { themeSnapshot } = useTheme();
  const typography = themeSnapshot.resolved.typography;

  const handleChange = (tokenKey: keyof TypographyTokens, value: string) => {
    themeStore.setTypographyToken(tokenKey, value);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Font Families */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">
          Font Families
        </div>
        <div className="border-t border-border px-3 pb-2">
          <TypographyTokenRow tokenKey="uiFontFamily" label="UI Font Family">
            <FontFamilyInput
              value={typography.uiFontFamily ?? ""}
              onChange={(v) => handleChange("uiFontFamily", v)}
            />
          </TypographyTokenRow>
          <TypographyTokenRow tokenKey="codeFontFamily" label="Code Font Family">
            <FontFamilyInput
              value={typography.codeFontFamily ?? ""}
              onChange={(v) => handleChange("codeFontFamily", v)}
            />
          </TypographyTokenRow>
        </div>
      </div>

      {/* Font Sizes */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">
          Font Sizes
        </div>
        <div className="border-t border-border px-3 pb-2">
          <TypographyTokenRow tokenKey="uiFontSize" label="UI Font Size">
            <FontSizeControl
              value={typography.uiFontSize ?? "14px"}
              onChange={(v) => handleChange("uiFontSize", v)}
              min={10}
              max={20}
            />
          </TypographyTokenRow>
          <TypographyTokenRow tokenKey="codeFontSize" label="Code Font Size">
            <FontSizeControl
              value={typography.codeFontSize ?? "13px"}
              onChange={(v) => handleChange("codeFontSize", v)}
              min={10}
              max={24}
            />
          </TypographyTokenRow>
        </div>
      </div>

      {/* Spacing */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">
          Spacing
        </div>
        <div className="border-t border-border px-3 pb-2">
          <TypographyTokenRow tokenKey="lineHeight" label="Line Height">
            <LineHeightControl
              value={typography.lineHeight ?? "1.5"}
              onChange={(v) => handleChange("lineHeight", v)}
            />
          </TypographyTokenRow>
        </div>
      </div>
    </div>
  );
}
