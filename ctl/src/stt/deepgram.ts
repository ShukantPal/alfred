export interface DeepgramSttOptions {
  apiKey?: string;
  model: string;
  endpointingMs: number;
  wakeOnInterim: boolean;
  onTranscript(payload: unknown): void;
}

type ConnectionState = "idle" | "connecting" | "open" | "closed";

export class DeepgramStt {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly endpointingMs: number;
  private readonly wakeOnInterim: boolean;
  private readonly onTranscript: (payload: unknown) => void;
  private socket?: WebSocket;
  private state: ConnectionState = "idle";
  private keepAlive?: Timer;
  private isClosed = false;

  constructor(options: DeepgramSttOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.endpointingMs = options.endpointingMs;
    this.wakeOnInterim = options.wakeOnInterim;
    this.onTranscript = options.onTranscript;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  sendPcm(buffer: Uint8Array): void {
    if (this.isClosed || !this.apiKey || buffer.byteLength === 0) return;
    this.ensureConnected();
    if (this.state !== "open" || !this.socket) return;
    this.socket.send(toArrayBuffer(buffer));
  }

  close(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.isClosed = true;
    this.state = "closed";
  }

  private ensureConnected(): void {
    if (
      this.isClosed ||
      !this.apiKey ||
      this.state === "connecting" ||
      this.state === "open"
    ) {
      return;
    }

    this.state = "connecting";
    const url = new URL("wss://api.deepgram.com/v1/listen");
    url.searchParams.set("model", this.model);
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("channels", "1");
    url.searchParams.set("interim_results", "true");
    url.searchParams.set("endpointing", String(this.endpointingMs));
    url.searchParams.set("utterance_end_ms", "1000");

    console.log(`[ctl] Deepgram STT connecting model=${this.model}`);
    const socket = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    } as unknown as string[]);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.state = "open";
      console.log("[ctl] Deepgram STT connected");
      this.keepAlive = setInterval(() => {
        if (this.state === "open") {
          socket.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8_000);
    });

    socket.addEventListener("message", event => {
      const payload = parseDeepgramMessage(event.data);
      if (!payload) return;
      if (!this.wakeOnInterim && isInterim(payload)) return;
      this.onTranscript(payload);
    });

    socket.addEventListener("close", event => {
      if (this.keepAlive) clearInterval(this.keepAlive);
      this.keepAlive = undefined;
      this.state = this.isClosed ? "closed" : "idle";
      this.socket = undefined;
      console.log(`[ctl] Deepgram STT disconnected code=${event.code}`);
    });

    socket.addEventListener("error", event => {
      console.error("[ctl] Deepgram STT websocket error", event);
    });
  }
}

export function createDeepgramSttFromEnv(
  env: NodeJS.ProcessEnv,
  onTranscript: (payload: unknown) => void,
): DeepgramStt {
  return new DeepgramStt({
    apiKey: env.DEEPGRAM_API_KEY,
    model: env.DEEPGRAM_STT_MODEL ?? "nova-3",
    endpointingMs: readInteger(env.DEEPGRAM_STT_ENDPOINTING_MS, 100),
    wakeOnInterim: env.DEEPGRAM_STT_WAKE_ON_INTERIM !== "0",
    onTranscript,
  });
}

export function extractRecallMixedAudio(payload: unknown): Uint8Array | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const event = "event" in payload ? String(payload.event) : "";
  if (event !== "audio_mixed_raw.data") return undefined;

  const encoded = findBufferString(payload);
  if (!encoded) return undefined;
  return Buffer.from(encoded, "base64");
}

function parseDeepgramMessage(data: unknown): unknown {
  try {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
    const payload = JSON.parse(text);
    if (payload.type && payload.type !== "Results") return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

function isInterim(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return "is_final" in payload && payload.is_final === false;
}

function findBufferString(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findBufferString(item);
      if (found) return found;
    }
    return undefined;
  }

  if ("buffer" in payload && typeof payload.buffer === "string") {
    return payload.buffer;
  }

  for (const value of Object.values(payload)) {
    const found = findBufferString(value);
    if (found) return found;
  }

  return undefined;
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}
