import type { APIRoute } from "astro";

import { buildLatheProjectFileJsonSchema } from "@lathe/shared/latheProjectFile";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildLatheProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
