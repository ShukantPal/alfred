import { config as loadDotEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadRepoEnv(): void {
  const sourceDir = fileURLToPath(new URL(".", import.meta.url));
  const agentDir = join(sourceDir, "..");
  const repoDir = join(agentDir, "..");

  loadIfPresent(join(repoDir, ".env"));
  loadIfPresent(join(agentDir, ".env"));
}

function loadIfPresent(path: string): void {
  if (!existsSync(path)) return;
  loadDotEnv({ path, override: false, quiet: true });
}
