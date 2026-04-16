import { useState, useEffect } from "react";
import { RotateCcwIcon, InfoIcon } from "lucide-react";
import { Slider } from "../../ui/slider";
import { Switch } from "../../ui/switch";
import { Button } from "../../ui/button";
import { themeStore } from "../../../theme";
import { useTheme } from "../../../hooks/useTheme";

export function TransparencyPanel() {
  const { themeSnapshot } = useTheme();
  const [platform, setPlatform] = useState<string | null>(null);
  const [hasDesktopBridge, setHasDesktopBridge] = useState(false);

  useEffect(() => {
    const bridge = (window as unknown as Record<string, unknown>).desktopBridge as
      | { getPlatform?: () => Promise<string> }
      | undefined;
    if (bridge) {
      setHasDesktopBridge(true);
      bridge.getPlatform?.().then(
        (p) => setPlatform(p),
        () => setPlatform(null),
      );
    }
  }, []);

  const transparency = themeSnapshot.resolved.transparency;
  const opacityPercent = Math.round((transparency.windowOpacity ?? 1) * 100);
  const vibrancyEnabled = transparency.vibrancy === "auto";
  const isMac = platform === "darwin";

  const opacityOverridden = themeStore.isTransparencyTokenOverridden("windowOpacity");
  const vibrancyOverridden = themeStore.isTransparencyTokenOverridden("vibrancy");

  const handleOpacityChange = (value: number) => {
    themeStore.setTransparencyToken("windowOpacity", value / 100);
  };

  const handleOpacityReset = () => {
    themeStore.resetTransparencyToken("windowOpacity");
  };

  const handleVibrancyToggle = (checked: boolean) => {
    themeStore.setTransparencyToken("vibrancy", checked ? "auto" : "none");
  };

  const handleVibrancyReset = () => {
    themeStore.resetTransparencyToken("vibrancy");
  };

  if (!hasDesktopBridge) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Window transparency requires the desktop app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Window Opacity */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">
          Window Opacity
        </div>
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              {opacityOverridden && (
                <div className="size-1.5 rounded-full bg-primary" title="Customized" />
              )}
              <span className="text-sm text-foreground">Window Opacity</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
                {opacityPercent}%
              </span>
              {opacityOverridden && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleOpacityReset}
                  title="Reset to default"
                >
                  <RotateCcwIcon className="size-3" />
                </Button>
              )}
            </div>
          </div>
          <Slider
            value={opacityPercent}
            onChange={handleOpacityChange}
            min={50}
            max={100}
            step={1}
          />
        </div>
      </div>

      {/* Window Vibrancy */}
      <div className="rounded-lg border border-border">
        <div className="px-3 py-2 text-sm font-medium text-foreground">
          Window Vibrancy
        </div>
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              {vibrancyOverridden && (
                <div className="size-1.5 rounded-full bg-primary" title="Customized" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">Enable Vibrancy</span>
                <span className="text-xs text-muted-foreground">
                  {isMac
                    ? "Native blur-behind effect (macOS only)"
                    : "Native blur-behind effect (macOS only, not available on this platform)"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch
                checked={vibrancyEnabled}
                onCheckedChange={handleVibrancyToggle}
                disabled={!isMac}
              />
              {vibrancyOverridden && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleVibrancyReset}
                  title="Reset to default"
                >
                  <RotateCcwIcon className="size-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
