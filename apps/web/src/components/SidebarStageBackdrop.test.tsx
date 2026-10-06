import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import { EDITIONS } from "../editions/editions";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveStageArtworkEdition,
  StageBackdropArt,
  StageBackdropButtonArt,
} from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("shows the chosen edition whenever artwork is enabled, on every build", () => {
    expect(resolveStageArtworkEdition("night-city", true)).toBe("night-city");
    expect(resolveStageArtworkEdition("tartan", true)).toBe("tartan");
    expect(resolveStageArtworkEdition("night-city", false)).toBeNull();
  });

  it("resolves supported environment pill labels", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Dev")).toBe("Dev");
    expect(resolveEnvironmentIdentificationPillLabel("nightly")).toBe("Nightly");
    expect(resolveEnvironmentIdentificationPillLabel("Latest")).toBeNull();
    expect(resolveEnvironmentIdentificationPillLabel("Alpha")).toBeNull();
  });

  it.each(EDITIONS.map((edition) => edition.id))(
    "uses unique SVG definition ids when %s artwork is rendered more than once",
    (edition) => {
      const markup = renderToStaticMarkup(
        <>
          <StageBackdropArt edition={edition} />
          <StageBackdropArt edition={edition} />
          <StageBackdropButtonArt edition={edition} />
        </>,
      );
      const ids = Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});
