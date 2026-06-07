import { config as loadDotEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadRepoEnv(): void {
  const sourceDir = fileURLToPath(new URL(".", import.meta.url));
  const agentDir = join(sourceDir, "..");
  const repoDir = join(agentDir, "..");

  // Repo-root .env is canonical; override empty keys Bun may pre-load from agent/.env.
  loadIfPresent(join(repoDir, ".env"), true);
  loadIfPresent(join(agentDir, ".env"), false);
}

function loadIfPresent(path: string, override = false): void {
  if (!existsSync(path)) return;
  loadDotEnv({ path, override, quiet: true });
}
