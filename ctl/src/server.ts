import type { Server, ServerWebSocket } from "bun";
import { createTalonCompanyDelegateFromEnv, type ActionItem } from "@alfred/agent";
import { extractRecallMixedAudio } from "./recall/audio";
import { createOpenAIRealtimeVoiceFromEnv } from "./realtime/openai";
import { createRouter } from "./routes";
import type { MeetingUtterance } from "./transcript";

export interface CtlServer {
  localBaseUrl: string;
  port: number;
  stop(): Promise<void>;
  broadcast(message: unknown): void;
  /** Point ctl at the agui Next app so live transcripts reach meeting notes. */
  setAguiBaseUrl(url: string | undefined): void;
  /** ctl's own public URL, shared with agui so the page can open the notes WS. */
  setPublicBaseUrl(url: string | undefined): void;
}

export interface CtlServerOptions {
  onStartScreenshare?(): Promise<void> | void;
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
  // Bridge Realtime function-call subdelegation into Talon sessions.
  const meetingId = process.env.ALFRED_MEETING_ID ?? `ctl-${crypto.randomUUID().slice(0, 8)}`;
  const delegate = createTalonCompanyDelegateFromEnv(process.env);
  console.log(`[ctl] Talon delegate configured (meeting ${meetingId})`);

  // Forward live meeting transcripts to the agui Next app so the meeting-notes
  // panel can summarize them. Fed by OpenAI Realtime input transcription below.
  let aguiBaseUrl = normalizeAguiBaseUrl(process.env.ALFRED_AGUI_PUBLIC_BASE_URL);
  let ctlPublicBaseUrl = normalizeAguiBaseUrl(process.env.ALFRED_CTL_PUBLIC_BASE_URL);
  let warnedNoAgui = false;
  // Push each utterance to /ws/notes subscribers for instant (sub-second) rendering
  // on the screenshare surface. The agui HTTP buffer (POST below) remains the source
  // of truth for catch-up polling and the end-of-meeting transcript/summary.
  const broadcastUtteranceToNotes = (utterance: MeetingUtterance) => {
    const notesSockets = [...sockets].filter(socket => socket.data.path === "/ws/notes");
    if (notesSockets.length === 0) return;
    const serialized = JSON.stringify({ type: "utterance", utterance });
    for (const socket of notesSockets) {
      socket.send(serialized);
    }
  };
  // Retain the full meeting transcript so the end-of-meeting action-item subagent
  // has the whole conversation. Generous cap as a memory guard, not a feature limit.
  const meetingTranscript: MeetingUtterance[] = [];
  const MAX_TRANSCRIPT_UTTERANCES = 20_000;
  const forwardUtterance = (utterance: MeetingUtterance) => {
    meetingTranscript.push(utterance);
    if (meetingTranscript.length > MAX_TRANSCRIPT_UTTERANCES) {
      meetingTranscript.splice(0, meetingTranscript.length - MAX_TRANSCRIPT_UTTERANCES);
    }
    broadcastUtteranceToNotes(utterance);
    if (!aguiBaseUrl) {
      if (!warnedNoAgui) {
        console.warn("[ctl] meeting notes disabled until agui URL is configured");
        warnedNoAgui = true;
      }
      return;
    }
    void postUtteranceToAgui(aguiBaseUrl, utterance);
  };

  // Hand agui ctl's public URL so the screenshare page can derive the notes WS
  // endpoint. Best-effort: if it fails, the page falls back to polling only.
  const pushConfigToAgui = () => {
    if (!aguiBaseUrl || !ctlPublicBaseUrl) return;
    void postConfigToAgui(aguiBaseUrl, ctlPublicBaseUrl);
  };

  // End-of-meeting subagent: turn the retained transcript into structured action
  // items, then push them to the agui screenshare surface for live display.
  const createActionItems = async (): Promise<{ count: number }> => {
    const transcript = meetingTranscript
      .map(utterance => `${utterance.speaker}: ${utterance.text}`)
      .join("\n");
    if (!transcript.trim()) {
      console.warn("[ctl] create_action_items called with an empty transcript");
      return { count: 0 };
    }
    const items = await delegate.extractActionItems({ meetingId, transcript });
    console.log(`[ctl] action-item subagent returned ${items.length} items`);
    if (aguiBaseUrl) {
      await postActionItemsToAgui(aguiBaseUrl, items);
    } else {
      console.warn("[ctl] action items generated but agui URL is not configured; cannot display");
    }
    return { count: items.length };
  };

  const speaker = { id: "meeting", displayName: "Participant" };
  const realtimeVoice = createOpenAIRealtimeVoiceFromEnv(process.env, {
    delegate,
    meetingId,
    speaker,
    onStatus(message) {
      sendMediaJson(sockets, { type: "status", message });
    },
    onUtterance: forwardUtterance,
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
    onStartScreenshare() {
      return options.onStartScreenshare?.();
    },
    onCreateActionItems() {
      return createActionItems();
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

      if (
        url.pathname === "/ws/recall" ||
        url.pathname === "/ws/media" ||
        url.pathname === "/ws/notes"
      ) {
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
    async stop() {
      for (const socket of sockets) {
        socket.close();
      }
      realtimeVoice.close();
      await delegate.close();
      server.stop(true);
    },
    broadcast,
    setAguiBaseUrl(url) {
      aguiBaseUrl = normalizeAguiBaseUrl(url);
      if (aguiBaseUrl) {
        console.log(`[ctl] meeting notes -> ${aguiBaseUrl}/api/meeting/transcript`);
      }
      pushConfigToAgui();
    },
    setPublicBaseUrl(url) {
      ctlPublicBaseUrl = normalizeAguiBaseUrl(url);
      if (ctlPublicBaseUrl) {
        console.log(`[ctl] notes websocket -> ${toWsUrl(ctlPublicBaseUrl)}/ws/notes`);
      }
      pushConfigToAgui();
    },
  };
}

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}

async function postConfigToAgui(baseUrl: string, ctlPublicBaseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/meeting/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ctlBaseUrl: ctlPublicBaseUrl }),
    });
    if (!response.ok) {
      console.warn(`[ctl] agui config POST failed (${response.status})`);
    }
  } catch (error) {
    console.warn("[ctl] agui config POST failed", error);
  }
}

function normalizeAguiBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim().replace(/\/$/, "");
  return trimmed || undefined;
}

async function postUtteranceToAgui(baseUrl: string, utterance: MeetingUtterance): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/meeting/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(utterance),
    });
    if (!response.ok) {
      console.warn(`[ctl] agui transcript POST failed (${response.status})`);
    }
  } catch (error) {
    console.warn("[ctl] agui transcript POST failed", error);
  }
}

async function postActionItemsToAgui(baseUrl: string, items: ActionItem[]): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/meeting/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!response.ok) {
      console.warn(`[ctl] agui tasks POST failed (${response.status})`);
    }
  } catch (error) {
    console.warn("[ctl] agui tasks POST failed", error);
  }
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
