import { useTheme } from "../../../hooks/useTheme";
import { themeStore } from "../../../theme";
import { TypographyTokenRow } from "./TypographyTokenRow";
import { FontSizeControl } from "./FontSizeControl";
import { LineHeightControl } from "./LineHeightControl";
import { CODE_FONT_PRESETS, FontFamilySelect, UI_FONT_PRESETS } from "./FontFamilySelect";
import type { TypographyTokens } from "@t3tools/contracts";

export function TypographyPanel() {
  const { themeSnapshot } = useTheme();
  const typography = themeSnapshot.resolved.typography;

  const handleChange = (tokenKey: keyof TypographyTokens, value: string) => {
    // Empty string from the preset list is the "System default" sentinel —
    // translate it into a reset so the token returns to theme defaults.
    if (value === "") {
      themeStore.resetTypographyToken(tokenKey);
      return;
    }
    themeStore.setTypographyToken(tokenKey, value);
  };

  const uiFontOverridden = themeStore.isTypographyTokenOverridden("uiFontFamily");
  const codeFontOverridden = themeStore.isTypographyTokenOverridden("codeFontFamily");

  return (
    <div className="flex flex-col gap-3">
      {/* Font Families */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">Font Families</div>
        <div className="border-t border-border px-3 pb-2">
          <TypographyTokenRow tokenKey="uiFontFamily" label="UI Font Family">
            <FontFamilySelect
              presets={UI_FONT_PRESETS}
              value={typography.uiFontFamily ?? ""}
              isOverridden={uiFontOverridden}
              onChange={(v) => handleChange("uiFontFamily", v)}
            />
          </TypographyTokenRow>
          <TypographyTokenRow tokenKey="codeFontFamily" label="Code Font Family">
            <FontFamilySelect
              presets={CODE_FONT_PRESETS}
              value={typography.codeFontFamily ?? ""}
              isOverridden={codeFontOverridden}
              onChange={(v) => handleChange("codeFontFamily", v)}
            />
          </TypographyTokenRow>
        </div>
      </div>

      {/* Font Sizes */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">Font Sizes</div>
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
        <div className="px-3 py-2 text-sm font-medium text-foreground">Spacing</div>
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
