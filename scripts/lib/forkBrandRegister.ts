// @effect-diagnostics nodeBuiltinImport:off - a Node load hook installed before the server's Effect runtime starts.
/**
 * Fork-only. Applies the brand layer to source the server runs unbundled in
 * dev (`node --import ../../scripts/lib/forkBrandRegister.ts src/bin.ts`), so
 * dev shows what the bundle ships. Rewrites keep line numbers; only columns on
 * a rewritten line shift.
 */
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

import { FORK_BRAND_TOKEN, isBrandableModule, rebrandSource } from "./forkBrand.ts";

const decoder = new TextDecoder();

NodeModule.registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith("file:") || loaded.source === undefined || loaded.source === null) {
      return loaded;
    }
    const path = NodeURL.fileURLToPath(url);
    if (!isBrandableModule(path)) return loaded;
    const source =
      typeof loaded.source === "string" ? loaded.source : decoder.decode(loaded.source);
    if (!source.includes(FORK_BRAND_TOKEN)) return loaded;
    const result = rebrandSource(source, path);
    return result.map === null ? loaded : { ...loaded, source: result.code };
  },
});
