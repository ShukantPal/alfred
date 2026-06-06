import type { Server, ServerWebSocket } from "bun";
import { createAgentClient } from "./agent/client";
import { extractRecallMixedAudio } from "./recall/audio";
import { createOpenAIRealtimeVoiceFromEnv } from "./realtime/openai";
import { createRouter } from "./routes";

export interface CtlServer {
  localBaseUrl: string;
  port: number;
  stop(): void;
  broadcast(message: unknown): void;
}

export interface CtlServerOptions {
  onStartScreenshare?(): void;
}

interface WebSocketData {
  path: string;
}

type MediaSocket = ServerWebSocket<WebSocketData>;
type MediaCommand =
  | { type: "status"; message?: string }
  | { type: "start_screenshare" }
  | { type: "audio_level"; level: number }
  | { type: "speak_stream_start"; id: string; text: string; sampleRate: number }
  | { type: "speak_stream_end"; id: string }
  | { type: "speak_stream_clear" }
  | { type: "speak_stream_error"; id: string; message: string };

export function startCtlServer(
  hostname: string,
  port: number,
  options: CtlServerOptions = {},
): CtlServer {
  const sockets = new Set<ServerWebSocket<WebSocketData>>();
  const audioLog = createAudioChunkLogger(30_000);
  const broadcast = (message: MediaCommand) => {
    if (message.type === "start_screenshare") {
      options.onStartScreenshare?.();
      return;
    }
    sendMediaJson(sockets, message);
  };
  // Bridge to the agent/ harness for Realtime function-call subdelegation.
  const agentUrl = process.env.ALFRED_AGENT_URL ?? "ws://127.0.0.1:8787";
  const meetingId = process.env.ALFRED_MEETING_ID ?? `ctl-${crypto.randomUUID().slice(0, 8)}`;
  const agent = createAgentClient({ url: agentUrl, meetingId });
  console.log(`[ctl] agent bridge -> ${agentUrl} (meeting ${meetingId})`);

  const speaker = { id: "meeting", displayName: "Participant" };
  const realtimeVoice = createOpenAIRealtimeVoiceFromEnv(process.env, {
    agent,
    speaker,
    onStatus(message) {
      sendMediaJson(sockets, { type: "status", message });
    },
    onAudioStart(id, sampleRate) {
      sendMediaJson(sockets, {
        type: "speak_stream_start",
        id,
        text: "",
        sampleRate,
      });
    },
    onAudio(audio) {
      for (const socket of [...sockets].filter(socket => socket.data.path === "/ws/media")) {
        socket.send(audio);
      }
    },
    onAudioEnd(id) {
      sendMediaJson(sockets, { type: "speak_stream_end", id });
    },
    onAudioClear() {
      sendMediaJson(sockets, { type: "speak_stream_clear" });
    },
  });
  if (realtimeVoice.enabled) {
    console.log("[ctl] OpenAI Realtime voice enabled");
  } else {
    console.warn("[ctl] OpenAI Realtime voice requested but OPENAI_API_KEY is not set");
  }

  console.log("[ctl] OpenAI Realtime is the only ctl voice path");
  const router = createRouter({
    onRecallWebhook() {
      // Recall transcript webhooks are ignored; ctl voice is driven by OpenAI Realtime audio.
    },
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
              sendMediaJson(sockets, {
                type: "audio_level",
                level: calculatePcmLevel(audio),
              });
              if (realtimeVoice.enabled) {
                realtimeVoice.sendPcm(audio);
              }
            } else {
              console.log(`[ctl] websocket message /ws/recall ${summarizePayload(payload)}`);
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
      realtimeVoice.close();
      agent.close();
      server.stop(true);
    },
    broadcast,
  };
}

function sendMediaJson(sockets: Set<MediaSocket>, message: MediaCommand): void {
  sendMediaJsonToSockets(
    [...sockets].filter(socket => socket.data.path === "/ws/media"),
    message,
  );
}

function sendMediaJsonToSockets(sockets: MediaSocket[], message: MediaCommand): void {
  const serialized = JSON.stringify(message);
  for (const socket of sockets) {
    socket.send(serialized);
  }
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

function calculatePcmLevel(audio: Uint8Array): number {
  const sampleCount = Math.floor(audio.byteLength / 2);
  if (sampleCount === 0) return 0;

  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32768;
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  return Math.max(0, Math.min(1, rms * 10));
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
