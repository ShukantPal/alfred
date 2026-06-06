import { config as loadDotEnv } from "dotenv";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadRepoEnv(): void {
  const sourceDir = fileURLToPath(new URL(".", import.meta.url));
  const repoEnvPath = join(sourceDir, "..", "..", ".env");
  loadDotEnv({ path: repoEnvPath, quiet: true });
}
