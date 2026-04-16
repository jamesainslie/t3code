import { describe, expect, it } from "vitest";
import { IconSetRegistry, BUILTIN_FILE_ICON_SETS, BUILTIN_UI_ICON_SETS } from "./icon-registry";
import type { IconSetManifest } from "@t3tools/contracts";

describe("IconSetRegistry", () => {
  it("fresh registry has 3 file-icon sets", () => {
    const registry = new IconSetRegistry();
    expect(registry.listByType("file-icons")).toHaveLength(3);
  });

  it("fresh registry has 2 ui-icon sets", () => {
    const registry = new IconSetRegistry();
    expect(registry.listByType("ui-icons")).toHaveLength(2);
  });

  it('get("default", "file-icons") returns manifest with name "Default (VS Code)"', () => {
    const registry = new IconSetRegistry();
    const manifest = registry.get("default", "file-icons");
    expect(manifest).toBeDefined();
    expect(manifest!.name).toBe("Default (VS Code)");
  });

  it('get("default", "ui-icons") returns manifest with name "Default (Lucide)"', () => {
    const registry = new IconSetRegistry();
    const manifest = registry.get("default", "ui-icons");
    expect(manifest).toBeDefined();
    expect(manifest!.name).toBe("Default (Lucide)");
  });

  it("register adds a custom set and listByType includes it", () => {
    const registry = new IconSetRegistry();
    const custom: IconSetManifest = {
      id: "custom",
      name: "Custom Icons",
      version: "1.0.0",
      type: "file-icons",
      description: "Custom file icons",
      previewIcons: ["ts"],
    };
    registry.register(custom);
    expect(registry.listByType("file-icons")).toHaveLength(4);
    expect(registry.get("custom", "file-icons")).toEqual(custom);
  });

  it("unregister removes a set and get returns undefined", () => {
    const registry = new IconSetRegistry();
    const custom: IconSetManifest = {
      id: "custom",
      name: "Custom Icons",
      version: "1.0.0",
      type: "ui-icons",
      description: "Custom UI icons",
      previewIcons: [],
    };
    registry.register(custom);
    expect(registry.get("custom", "ui-icons")).toBeDefined();
    registry.unregister("custom", "ui-icons");
    expect(registry.get("custom", "ui-icons")).toBeUndefined();
  });

  it("resolve with explicit defaults returns full manifests", () => {
    const registry = new IconSetRegistry();
    const resolved = registry.resolve({ fileIcons: "default", uiIcons: "default" });
    expect(resolved.fileIcons.name).toBe("Default (VS Code)");
    expect(resolved.uiIcons.name).toBe("Default (Lucide)");
  });

  it("resolve with nonexistent file-icons falls back to default", () => {
    const registry = new IconSetRegistry();
    const resolved = registry.resolve({ fileIcons: "nonexistent" });
    expect(resolved.fileIcons.name).toBe("Default (VS Code)");
    expect(resolved.uiIcons.name).toBe("Default (Lucide)");
  });

  it("resolve with empty config returns defaults for both", () => {
    const registry = new IconSetRegistry();
    const resolved = registry.resolve({});
    expect(resolved.fileIcons.name).toBe("Default (VS Code)");
    expect(resolved.uiIcons.name).toBe("Default (Lucide)");
  });
});

describe("builtin manifests", () => {
  it("BUILTIN_FILE_ICON_SETS has correct ids", () => {
    const ids = BUILTIN_FILE_ICON_SETS.map((s) => s.id);
    expect(ids).toEqual(["default", "material", "catppuccin"]);
  });

  it("BUILTIN_UI_ICON_SETS has correct ids", () => {
    const ids = BUILTIN_UI_ICON_SETS.map((s) => s.id);
    expect(ids).toEqual(["default", "phosphor"]);
  });
});
