// apps/web/src/hooks/useIconSet.ts
import { useTheme } from "./useTheme";
import { themeStore } from "../theme";
import type { IconSetManifest } from "@t3tools/contracts";

interface UseIconSetReturn {
  fileIconSet: IconSetManifest;
  uiIconSet: IconSetManifest;
  fileIconSetId: string;
  uiIconSetId: string;
  setFileIconSet: (id: string) => void;
  setUiIconSet: (id: string) => void;
}

export function useIconSet(): UseIconSetReturn {
  const { themeSnapshot } = useTheme();

  return {
    fileIconSet: themeSnapshot.resolved.icons.fileIcons,
    uiIconSet: themeSnapshot.resolved.icons.uiIcons,
    fileIconSetId: themeStore.getFileIconSetId(),
    uiIconSetId: themeStore.getUiIconSetId(),
    setFileIconSet: (id: string) => themeStore.setFileIconSet(id),
    setUiIconSet: (id: string) => themeStore.setUiIconSet(id),
  };
}
