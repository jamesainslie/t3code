import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import { forkDesktopSchemes } from "@t3tools/shared/forkIdentity";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = forkDesktopSchemes.map((scheme) => `${scheme}://app`);
