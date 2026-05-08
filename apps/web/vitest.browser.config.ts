import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        "~": srcPath,
      },
    },
    server: {
      // The app dev server uses a fixed port, but browser tests need to allow
      // concurrent runs to claim the next available port.
      strictPort: false,
    },
    test: {
      // Include any *.browser.tsx file under src/. Browser-mode tests aren't
      // strictly tied to React components — services and stores with
      // window/localStorage dependencies (e.g. theme persistence) belong here
      // too, so the glob spans the whole src tree.
      include: ["src/**/*.browser.tsx"],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
        headless: true,
        api: {
          strictPort: false,
        },
      },
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
