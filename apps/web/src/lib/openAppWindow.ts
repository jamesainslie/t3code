import type { AnyRouter } from "@tanstack/react-router";

/** Opens an app route in its own window. Desktop turns same-origin opens into app windows. */
export function openAppWindow(router: AnyRouter, href: string): void {
  const url = new URL(router.history.createHref(href), window.location.href);
  window.open(url.href, "_blank", "noopener,width=1100,height=800");
}
