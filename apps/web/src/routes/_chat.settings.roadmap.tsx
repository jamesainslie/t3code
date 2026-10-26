import { createFileRoute } from "@tanstack/react-router";

import { RoadmapSettingsPanel } from "../components/settings/RoadmapSettings";

export const Route = createFileRoute("/_chat/settings/roadmap")({
  component: RoadmapSettingsPanel,
});
