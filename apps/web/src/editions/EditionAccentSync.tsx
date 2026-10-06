import { useEffect } from "react";

import { useStageArtworkEdition } from "../components/SidebarStageBackdrop";
import { useClientSettings, useEnvironmentIdentificationMode } from "../hooks/useSettings";
import { applyEditionAccent, resolveEditionAccent } from "./editionAccent";

/** Keeps the document's edition accent in step with the shown edition and the accent switch. */
export function EditionAccentSync() {
  const artworkEdition = useStageArtworkEdition(useEnvironmentIdentificationMode() === "artwork");
  const accentEnabled = useClientSettings((settings) => settings.editionAccent);
  const accent = resolveEditionAccent({ artworkEdition, accentEnabled });

  useEffect(() => {
    applyEditionAccent(document.documentElement, accent);
  }, [accent]);

  return null;
}
