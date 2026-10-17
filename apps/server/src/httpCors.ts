import { ORCHESTRATION_PROTOCOL_HEADER } from "@lathe/contracts";
import { forkDesktopSchemes } from "@lathe/shared/forkIdentity";

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
