import { loadRepoEnv } from "./env.js";
import { Memory } from "./memory.js";
import { COMPANY_DOCS } from "./seed-data.js";

loadRepoEnv();

async function main() {
  const memory = new Memory();
  await memory.connect();
  await memory.seedContext(COMPANY_DOCS);
  console.log(`[seed] inserted ${COMPANY_DOCS.length} context docs`);
  await memory.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
