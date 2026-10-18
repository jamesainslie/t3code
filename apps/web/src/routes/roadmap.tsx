import { createFileRoute, redirect } from "@tanstack/react-router";

import { RoadmapPage } from "../components/roadmap/RoadmapPage";
import { validateRoadmapSearch } from "../components/roadmap/roadmapPage.logic";

export const Route = createFileRoute("/roadmap")({
  validateSearch: validateRoadmapSearch,
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: RoadmapPage,
});
