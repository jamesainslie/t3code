import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { isMacPlatform } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const menuBarEnabledAtom = Atom.make(
  Effect.tryPromise(() => window.desktopBridge?.getMenuBarEnabled() ?? Promise.resolve(false)),
).pipe(Atom.withLabel("desktop:menu-bar-enabled"));

export function MenuBarSetting() {
  const bridge =
    typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
      ? window.desktopBridge
      : undefined;
  const stored = useEnvironmentQuery(bridge ? menuBarEnabledAtom : null);
  // The setter answers with the saved value, so it stands in for a reload.
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  if (!bridge) return null;
  const enabled = saved ?? stored.data;

  return (
    <SettingsRow
      {...searchableSetting("menu-bar-icon")}
      description="Show Lathe in the menu bar, with a dot when a thread needs you. It keeps watching your environments while Lathe runs, even with every window closed."
      control={
        <Switch
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onCheckedChange={async (checked) => {
            setSaving(true);
            setSaved(await bridge.setMenuBarEnabled(checked).catch(() => !checked));
            setSaving(false);
          }}
          aria-label="Menu bar icon"
        />
      }
    />
  );
}
