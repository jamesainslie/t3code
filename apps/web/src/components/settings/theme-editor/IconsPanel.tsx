import { useIconSet } from "../../../hooks/useIconSet";
import { IconSetRegistry } from "../../../theme";
import { IconSetCard } from "./IconSetCard";

// Module-level singleton — shares builtin sets, no per-render allocation
const iconRegistry = new IconSetRegistry();

export function IconsPanel() {
  const { fileIconSet, uiIconSet, setFileIconSet, setUiIconSet } =
    useIconSet();

  const fileIconSets = iconRegistry.listByType("file-icons");
  const uiIconSets = iconRegistry.listByType("ui-icons");

  return (
    <div className="flex flex-col gap-6">
      {/* File Icons */}
      <section className="flex flex-col gap-2">
        <div className="px-1">
          <h3 className="text-sm font-medium text-foreground">File Icons</h3>
          <p className="text-xs text-muted-foreground">
            Choose which icon set to use for file and folder icons in the
            sidebar.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {fileIconSets.map((manifest) => (
            <IconSetCard
              key={manifest.id}
              manifest={manifest}
              isSelected={manifest.id === fileIconSet.id}
              onSelect={() => setFileIconSet(manifest.id)}
              disabled={manifest.version === "0.0.0"}
            />
          ))}
        </div>
      </section>

      {/* UI Icons */}
      <section className="flex flex-col gap-2">
        <div className="px-1">
          <h3 className="text-sm font-medium text-foreground">UI Icons</h3>
          <p className="text-xs text-muted-foreground">
            Choose which icon set to use for buttons, menus, and other interface
            elements.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {uiIconSets.map((manifest) => (
            <IconSetCard
              key={manifest.id}
              manifest={manifest}
              isSelected={manifest.id === uiIconSet.id}
              onSelect={() => setUiIconSet(manifest.id)}
              disabled={manifest.version === "0.0.0"}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
