import { loadRepoEnv } from "./env.js";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { OutboundFrame } from "./protocol.js";

loadRepoEnv();

/**
 * Simulates ctl/: opens a session, sends an addressed utterance, prints the streamed
 * answer and the delegation trace. Run the server + seed first.
 *
 *   bun run agent:start  # in one terminal (after build), or: bun run agent:dev
 *   bun run agent:seed   # seed company context
 *   bun run agent:demo   # this client
 */

const URL = process.env.AGENT_URL ?? "ws://localhost:8787";
const meetingId = "demo-meeting-1";

const ws = new WebSocket(URL);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "session",
      action: "open",
      meetingId,
      participants: [{ id: "u-zain", displayName: "Zain" }],
    })
  );

  const correlationId = randomUUID();
  ws.send(
    JSON.stringify({
      type: "sendMessage",
      correlationId,
      meetingId,
      speaker: { id: "u-zain", displayName: "Zain" },
      text:
        "I need to ask Priya whether the onboarding redesign is safe to ship to prod, but she's on holiday. " +
        "Can the redesign go out now?",
      ts: Date.now(),
      addressedToAgent: true,
    })
  );
});

process.stdout.write("\nAgent: ");
ws.on("message", (data) => {
  const f = JSON.parse(data.toString()) as OutboundFrame;
  if (f.type === "agentMessage") {
    process.stdout.write(f.delta);
    if (f.done) {
      console.log("\n");
      ws.close();
      process.exit(0);
    }
  } else if (f.type === "agentTrace") {
    process.stderr.write(`\n  [trace] ${f.node}:${f.event}${f.detail ? " — " + f.detail : ""}`);
  } else if (f.type === "agentError") {
    console.error("\n[agentError]", f.message);
    ws.close();
    process.exit(1);
  }
});
