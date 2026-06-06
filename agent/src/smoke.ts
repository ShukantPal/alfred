import { loadRepoEnv } from "./env.js";
import { randomUUID } from "node:crypto";
import { Memory } from "./memory.js";
import { Harness } from "./harness.js";
import { COMPANY_DOCS } from "./seed-data.js";
import { initWeave } from "./observability.js";
import type { OutboundFrame } from "./protocol.js";

loadRepoEnv();

/**
 * In-process end-to-end demo of the fan-out delegation harness. Exercises Weave init, memory
 * seed + retrieval, planner -> parallel subagents -> streaming synthesizer — in ONE process, so
 * it needs no ctl/, no WebSocket, no docker. Redis is used if reachable, else in-memory fallback.
 *
 *   bun run agent:smoke
 */
const QUESTIONS = [
  "I need to ask Priya whether the onboarding redesign is safe to ship to prod, but she's on holiday. Can the redesign go out now?",
  "What are our brand colors and fonts?",
];

async function ask(harness: Harness, meetingId: string, question: string): Promise<void> {
  const traces: string[] = [];
  let answer = "";
  let action: string | undefined;

  await harness.handle({
    correlationId: randomUUID(),
    meetingId,
    speaker: "Zain",
    text: question,
    emit: (f: OutboundFrame) => {
      if (f.type === "agentMessage") answer += f.delta;
      else if (f.type === "agentTrace")
        traces.push(`${f.node}:${f.event}${f.detail ? ` — ${f.detail}` : ""}`);
      else if (f.type === "agentAction" && f.action.kind === "presentUrl")
        action = `present "${f.action.title}" → ${f.action.url}`;
      else if (f.type === "agentError") console.error("  [error]", f.message);
    },
  });

  console.log(`\n❓ ${question}\n`);
  console.log("  delegation tree:");
  for (const t of traces) console.log("   • " + t);
  if (action) console.log(`\n  📺 agentAction: ${action}`);
  console.log(`\n  🗣️  ${answer}\n${"─".repeat(80)}`);
}

async function main() {
  await initWeave(process.env.WEAVE_PROJECT ?? "meeting-agent");

  const memory = new Memory();
  await memory.connect();
  await memory.seedContext(COMPANY_DOCS);

  // present-mode ON so the demo also shows the "put a doc on screen" action.
  const harness = new Harness(memory, { presentMode: true });
  const meetingId = `smoke-${randomUUID().slice(0, 8)}`;

  for (const q of QUESTIONS) await ask(harness, meetingId, q);

  await memory.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
