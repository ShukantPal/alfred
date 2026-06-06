import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Absolute path to agui/. Next must resolve deps from agui/node_modules, not the
// repo root (alfred/ has its own bun.lock; @copilotkit is only installed here).
const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: appDir,
  turbopack: {
    root: appDir,
    // Paths are relative to turbopack.root (appDir).
    resolveAlias: {
      "@copilotkit/react-core/v2":
        "./node_modules/@copilotkit/react-core/dist/v2/index.mjs",
      "@copilotkit/react-core/v2/styles.css":
        "./node_modules/@copilotkit/react-core/dist/v2/index.css",
      "@copilotkit/runtime/v2":
        "./node_modules/@copilotkit/runtime/dist/v2/index.mjs",
    },
  },
  // The /screenshare route is streamed into meetings as video — hide the dev
  // overlay so it doesn't appear in the shared frame.
  devIndicators: false,
  // Recall reaches agui through a Cloudflare quick tunnel in dev.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
