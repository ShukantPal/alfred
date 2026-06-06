import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import { InboundFrame, type OutboundFrame } from "./protocol.js";
import { Memory } from "./memory.js";
import { Harness } from "./harness.js";
import { initWeave } from "./observability.js";

/**
 * agent/ server. One WebSocket per meeting connection from ctl/.
 *
 * RPCs:
 *   in : { type:"session", action:"open"|"close", ... }
 *        { type:"sendMessage", correlationId, meetingId, speaker, text, addressedToAgent }
 *   out: streaming { type:"agentMessage", delta, done } + agentTrace / agentAction / agentError
 *
 * The agent only *acts on its own turn* when addressedToAgent is true, so it doesn't
 * respond to every sentence of human crosstalk. ctl/ owns address detection.
 */

const PORT = Number(process.env.AGENT_PORT ?? 8787);

async function main() {
  await initWeave(process.env.WEAVE_PROJECT ?? "meeting-agent");

  const memory = new Memory();
  await memory.connect();
  const harness = new Harness(memory);

  const wss = new WebSocketServer({ port: PORT });
  console.log(`[agent] listening ws://localhost:${PORT}`);

  wss.on("connection", (ws: WebSocket) => {
    const send = (frame: OutboundFrame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };

    ws.on("message", async (data) => {
      let frame: InboundFrame;
      try {
        frame = InboundFrame.parse(JSON.parse(data.toString()));
      } catch (e) {
        send({
          type: "agentError",
          correlationId: "n/a",
          meetingId: "n/a",
          message: `bad frame: ${e instanceof Error ? e.message : e}`,
        });
        return;
      }

      if (frame.type === "session") {
        // Record turns for working memory; seeding company context is done out-of-band.
        return;
      }

      // sendMessage: always log to working memory; only answer if addressed.
      await memory.appendTurn(frame.meetingId, frame.speaker.displayName, frame.text);
      if (!frame.addressedToAgent) return;

      await harness.handle({
        correlationId: frame.correlationId,
        meetingId: frame.meetingId,
        speaker: frame.speaker.displayName,
        text: frame.text,
        emit: send,
      });
    });

    ws.on("close", () => {});
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
