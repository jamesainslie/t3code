import type { Edition } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { createPreviewStore } from "../lib/previewStore";

const EDITION_PREVIEW_DELAY_MS = 120;
const store = createPreviewStore<Edition>(EDITION_PREVIEW_DELAY_MS);

/**
 * Shows `edition` on every stage surface without saving it, as the gallery and command
 * palette browse. Pass `null` when browsing ends to return to the saved edition.
 */
export const previewEdition = store.preview;

const selectEdition = (settings: { readonly edition: Edition }) => settings.edition;

/** The edition stage art shows right now: a preview while browsing, else the saved one. */
export function useEdition(): Edition {
  const saved = useClientSettings(selectEdition);
  const preview = useSyncExternalStore(store.subscribe, store.get, () => null);
  return preview ?? saved;
}
