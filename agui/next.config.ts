import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Absolute path to agui/. Next must resolve deps from agui/node_modules, not the
// repo root (alfred/ has its own bun.lock; @copilotkit is only installed here).
const appDir = path.dirname(fileURLToPath(import.meta.url));

// Server-side secrets (e.g. OPENAI_API_KEY for the CopilotKit agents) live in the
// repo-root .env alongside ctl's config, not in agui/. Next only auto-loads
// agui/.env*, so load the root file here. Existing env wins (ctl injects it when
// it spawns agui), and we never override what's already set.
loadRootEnv(path.join(appDir, "..", ".env"));

function loadRootEnv(envPath: string): void {
  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

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
