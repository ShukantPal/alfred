import type { Server, ServerWebSocket } from "bun";
import { createRouter } from "./routes";
import { createDeepgramSttFromEnv, extractRecallMixedAudio } from "./stt/deepgram";
import { createTranscriptResponder } from "./transcript";
import { createDeepgramTtsFromEnv } from "./tts/deepgram";

export interface CtlServer {
  localBaseUrl: string;
  port: number;
  stop(): void;
  broadcast(message: unknown): void;
}

interface WebSocketData {
  path: string;
}

export function startCtlServer(hostname: string, port: number): CtlServer {
  const sockets = new Set<ServerWebSocket<WebSocketData>>();
  const audioLog = createAudioChunkLogger(30_000);
  const tts = createDeepgramTtsFromEnv(process.env);
  const broadcast = (message: unknown) => {
    const serialized = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.data.path === "/ws/media") {
        socket.send(serialized);
      }
    }
  };
  const transcripts = createTranscriptResponder({ broadcast });
  const stt = createDeepgramSttFromEnv(process.env, payload =>
    transcripts.handle(payload, "deepgram"),
  );
  if (stt.enabled) {
    console.log("[ctl] Deepgram realtime STT enabled");
  } else {
    console.log("[ctl] Deepgram realtime STT disabled");
  }
  const router = createRouter({
    tts,
    onRecallWebhook: payload => transcripts.handle(payload, "webhook"),
  });

  const server: Server<WebSocketData> = Bun.serve<WebSocketData>({
    hostname,
    port,
    fetch(request, bunServer) {
      const url = new URL(request.url);

      if (url.pathname === "/ws/recall" || url.pathname === "/ws/media") {
        const upgraded = bunServer.upgrade(request, {
          data: { path: url.pathname },
        });
        return upgraded
          ? undefined
          : Response.json({ error: "WebSocket upgrade failed" }, { status: 400 });
      }

      return router.fetch(request);
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        console.log(`[ctl] websocket connected ${ws.data.path}`);
      },
      message(ws, message) {
        if (ws.data.path === "/ws/recall") {
          const payload = parseSocketMessage(message);
          if (payload) {
            const audio = extractRecallMixedAudio(payload);
            if (audio) {
              audioLog(audio.byteLength);
              stt.sendPcm(audio);
            } else {
              console.log(`[ctl] websocket message /ws/recall ${summarizePayload(payload)}`);
              transcripts.handle(payload, "websocket");
            }
          } else {
            console.log(`[ctl] websocket message /ws/recall ${stringifyMessage(message)}`);
          }
          return;
        }
        console.log(`[ctl] websocket message ${ws.data.path} ${stringifyMessage(message)}`);
      },
      close(ws) {
        sockets.delete(ws);
        console.log(`[ctl] websocket closed ${ws.data.path}`);
      },
    },
  });

  return {
    localBaseUrl: `http://${hostname}:${server.port ?? port}`,
    port: server.port ?? port,
    stop() {
      for (const socket of sockets) {
        socket.close();
      }
      stt.close();
      server.stop(true);
    },
    broadcast,
  };
}

function stringifyMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") return message;
  return `[${message.byteLength} bytes]`;
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload);
  const event = "event" in payload ? String(payload.event) : undefined;
  const type = "type" in payload ? String(payload.type) : undefined;
  const text = findTranscriptSummary(payload);
  return JSON.stringify({
    event,
    type,
    text: text ? truncate(text, 120) : undefined,
  });
}

function findTranscriptSummary(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findTranscriptSummary(item);
      if (found) return found;
    }
    return undefined;
  }

  if ("transcript" in payload && typeof payload.transcript === "string") {
    return payload.transcript;
  }

  for (const value of Object.values(payload)) {
    const found = findTranscriptSummary(value);
    if (found) return found;
  }

  return undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function createAudioChunkLogger(intervalMs: number) {
  let lastLogAt = 0;
  let chunkCount = 0;
  let byteCount = 0;

  return (bytes: number) => {
    chunkCount += 1;
    byteCount += bytes;

    const now = Date.now();
    if (now - lastLogAt < intervalMs) return;

    console.log(
      `[ctl] websocket message /ws/recall audio_mixed_raw.data ${chunkCount} chunks ${byteCount} bytes in last ${Math.round(intervalMs / 1000)}s`,
    );
    lastLogAt = now;
    chunkCount = 0;
    byteCount = 0;
  };
}

function parseSocketMessage(message: string | ArrayBuffer | Uint8Array): unknown {
  try {
    const text =
      typeof message === "string" ? message : new TextDecoder().decode(message);
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
