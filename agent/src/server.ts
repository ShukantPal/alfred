import { loadRepoEnv } from "./env";
import { createTalonCompanyDelegateFromEnv } from "./talon";

loadRepoEnv();

const delegate = createTalonCompanyDelegateFromEnv(process.env);
const info = await delegate.ready();

console.log(
  `[agent] configured Talon namespace=${info.namespace} agent=${info.agentName} grpc=${info.grpcEndpoint}`,
);
console.log(`[agent] Talon UI/REST ${info.uiEndpoint}`);
if (info.mcpTarget) {
  const args = info.mcpArgs?.length ? ` ${info.mcpArgs.join(" ")}` : "";
  console.log(`[agent] company-memory MCP ${info.mcpServerName} ${info.mcpTransport} -> ${info.mcpTarget}${args}`);
}

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await delegate.close();
  process.exit(0);
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await new Promise<void>(() => {});
