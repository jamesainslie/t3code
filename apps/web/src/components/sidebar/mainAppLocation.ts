import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/") ||
    pathname === "/usage" ||
    // Fork: roadmap.
    pathname === "/roadmap" ||
    pathname === "/pull-requests"
  );
}

let mainAppHref: string | null = null;
// Fork: roadmap. The roadmap as last left, view and filters included.
let roadmapHref: string | null = null;

export function MainAppLocationTracker() {
  const location = useLocation({
    select: (current) => ({ pathname: current.pathname, href: current.href }),
  });
  const href = isSidebarUtilityPage(location.pathname) ? null : location.href;
  const roadmap = location.pathname === "/roadmap" ? location.href : null;
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  useEffect(() => {
    if (roadmap !== null) roadmapHref = roadmap;
  }, [roadmap]);
  return null;
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Fork: roadmap. Back to where you were from the roadmap, or to the roadmap as you left it. */
export function useToggleRoadmap(fallbackRoadmapHref: string) {
  const navigate = useNavigate();
  const onRoadmap = useLocation({ select: (location) => location.pathname === "/roadmap" });
  return () =>
    navigate({
      href: onRoadmap ? (mainAppHref ?? "/") : (roadmapHref ?? fallbackRoadmapHref),
    });
}
