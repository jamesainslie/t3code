import { createFileRoute } from "@tanstack/react-router";

import { MarkdownSettings } from "../components/settings/MarkdownSettings";

export const Route = createFileRoute("/settings/markdown")({
  component: MarkdownSettings,
});
