import type {
  IconSetManifest,
  IconSetConfig,
  ResolvedIconSetConfig,
} from "@t3tools/contracts";

export const BUILTIN_FILE_ICON_SETS: IconSetManifest[] = [
  {
    id: "default",
    name: "Default (VS Code)",
    version: "1.0.0",
    type: "file-icons",
    description: "VS Code-style file icons",
    previewIcons: [
      "typescript",
      "react",
      "json",
      "markdown",
      "python",
      "rust",
      "go",
      "docker",
      "git",
      "yaml",
      "html",
      "css",
    ],
  },
  {
    id: "material",
    name: "Material",
    version: "0.0.0",
    type: "file-icons",
    description: "Material Design file icons (coming soon)",
    previewIcons: [],
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    version: "0.0.0",
    type: "file-icons",
    description: "Catppuccin pastel file icons (coming soon)",
    previewIcons: [],
  },
];

export const BUILTIN_UI_ICON_SETS: IconSetManifest[] = [
  {
    id: "default",
    name: "Default (Lucide)",
    version: "1.0.0",
    type: "ui-icons",
    description: "Lucide icons",
    previewIcons: [
      "Copy",
      "Download",
      "Plus",
      "Trash2",
      "Settings",
      "Search",
      "ChevronDown",
      "ChevronRight",
      "Check",
      "X",
      "Folder",
      "File",
    ],
  },
  {
    id: "phosphor",
    name: "Phosphor",
    version: "0.0.0",
    type: "ui-icons",
    description: "Phosphor icons (coming soon)",
    previewIcons: [],
  },
];

export class IconSetRegistry {
  private sets: Map<string, IconSetManifest> = new Map();

  constructor() {
    for (const set of [...BUILTIN_FILE_ICON_SETS, ...BUILTIN_UI_ICON_SETS]) {
      this.sets.set(`${set.type}:${set.id}`, set);
    }
  }

  register(manifest: IconSetManifest): void {
    this.sets.set(`${manifest.type}:${manifest.id}`, manifest);
  }

  unregister(id: string, type: "file-icons" | "ui-icons"): void {
    this.sets.delete(`${type}:${id}`);
  }

  get(
    id: string,
    type: "file-icons" | "ui-icons",
  ): IconSetManifest | undefined {
    return this.sets.get(`${type}:${id}`);
  }

  listByType(type: "file-icons" | "ui-icons"): IconSetManifest[] {
    return [...this.sets.values()].filter((s) => s.type === type);
  }

  resolve(config: Partial<IconSetConfig>): ResolvedIconSetConfig {
    const fileId = config.fileIcons ?? "default";
    const uiId = config.uiIcons ?? "default";
    const fileIcons =
      this.get(fileId, "file-icons") ?? this.get("default", "file-icons")!;
    const uiIcons =
      this.get(uiId, "ui-icons") ?? this.get("default", "ui-icons")!;
    return { fileIcons, uiIcons };
  }
}
