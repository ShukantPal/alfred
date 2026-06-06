import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Memory } from "./memory.js";
import { Harness } from "./harness.js";
import { COMPANY_DOCS } from "./seed-data.js";
import { initWeave } from "./observability.js";
import type { OutboundFrame } from "./protocol.js";

/**
 * In-process end-to-end smoke test. Exercises the WHOLE brain — Weave init, memory seed +
 * retrieval, orchestrator → subagents → streaming synthesizer — in a single process, so it
 * needs NO Redis, NO docker, NO WebSocket. Useful to verify the LLM provider + Weave wiring
 * before standing up the full ctl/ <-> agent/ plumbing.
 *
 *   npm run smoke
 */
async function main() {
  await initWeave(process.env.WEAVE_PROJECT ?? "meeting-agent");

  const memory = new Memory();
  await memory.connect(); // in-memory fallback is fine here; single process shares state.
  await memory.seedContext(COMPANY_DOCS);

  const harness = new Harness(memory);
  const meetingId = "smoke-meeting";

  const traces: string[] = [];
  const emit = (f: OutboundFrame) => {
    if (f.type === "agentMessage") {
      process.stdout.write(f.delta);
    } else if (f.type === "agentTrace") {
      traces.push(`${f.node}:${f.event}${f.detail ? " — " + f.detail : ""}`);
    } else if (f.type === "agentError") {
      console.error("\n[agentError]", f.message);
    }
  };

  process.stdout.write("\nAgent: ");
  await harness.handle({
    correlationId: randomUUID(),
    meetingId,
    speaker: "Zain",
    text:
      "I need to ask Priya whether the onboarding redesign is safe to ship to prod, but she's on holiday. " +
      "Can the redesign go out now?",
    emit,
  });

  console.log("\n\n[trace]\n  " + traces.join("\n  "));
  await memory.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
