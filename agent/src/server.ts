import { loadRepoEnv } from "./env";
import { createTalonCompanyDelegateFromEnv } from "./talon";

loadRepoEnv();

const delegate = createTalonCompanyDelegateFromEnv(process.env);
const info = await delegate.ready();

console.log(
  `[agent] configured Talon namespace=${info.namespace} agent=${info.agentName} grpc=${info.grpcEndpoint}`,
);
console.log(`[agent] Talon UI/REST ${info.uiEndpoint}`);
for (const mcp of info.mcpServers) {
  const args = mcp.args.length ? ` ${mcp.args.join(" ")}` : "";
  console.log(`[agent] MCP ${mcp.name} ${mcp.transport} -> ${mcp.target}${args}`);
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
