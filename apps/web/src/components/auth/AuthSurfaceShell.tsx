import { DEFAULT_EDITION } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import { StageBackdropArt } from "../SidebarStageBackdrop";
import { StandalonePage } from "../ui/standalone-page";

/**
 * Branded masthead for the CLI-connect authorize and callback pages. They run on the hosted
 * origin without the user's settings, so they always show the default edition.
 */
export function AuthSurfaceShell({ children }: { readonly children: ReactNode }) {
  return (
    <StandalonePage
      tone="brand"
      masthead={
        <header className="relative h-24 overflow-hidden bg-[linear-gradient(135deg,#1e61de,#17348e)] text-white">
          <div className="absolute inset-0" aria-hidden>
            <StageBackdropArt edition={DEFAULT_EDITION} />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_20%,rgba(7,18,55,0.46)_100%)]" />
          <div className="relative h-full p-5 sm:p-6">
            <p className="text-3xs font-semibold tracking-widest text-white/80 uppercase">
              {APP_DISPLAY_NAME}
            </p>
          </div>
        </header>
      }
    >
      {children}
    </StandalonePage>
  );
}
