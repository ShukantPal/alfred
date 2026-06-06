export interface DeepgramTtsOptions {
  apiKey?: string;
  model: string;
  sampleRate: number;
  timeoutMs: number;
}

export interface StreamingTtsAudio {
  bytes: Uint8Array;
}

export interface StreamingTtsOptions {
  onAudio(audio: StreamingTtsAudio): void;
}

export class DeepgramTts {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly sampleRate: number;
  private readonly timeoutMs: number;

  constructor(options: DeepgramTtsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.sampleRate = options.sampleRate;
    this.timeoutMs = options.timeoutMs;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  get streamingSampleRate(): number {
    return this.sampleRate;
  }

  async stream(text: string, options: StreamingTtsOptions): Promise<void> {
    if (!this.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not set.");
    }

    const url = new URL("wss://api.deepgram.com/v1/speak");
    url.searchParams.set("model", this.model);
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("sample_rate", String(this.sampleRate));

    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        socket.close();
        reject(new Error(`Deepgram streaming TTS timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);

      const complete = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        socket.close();
        resolve();
      };

      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        socket.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const socket = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
        },
      } as unknown as string[]);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "Speak", text }));
        socket.send(JSON.stringify({ type: "Flush" }));
      });

      socket.addEventListener("message", async event => {
        if (typeof event.data === "string") {
          const payload = parseDeepgramStreamingMessage(event.data);
          if (payload?.type === "Flushed") {
            complete();
          }
          return;
        }

        const bytes = await toUint8Array(event.data);
        if (bytes.byteLength > 0) {
          options.onAudio({ bytes });
        }
      });

      socket.addEventListener("close", () => {
        complete();
      });

      socket.addEventListener("error", event => {
        fail(new Error(`Deepgram streaming TTS websocket error: ${String(event)}`));
      });
    });
  }
}

export function createDeepgramTtsFromEnv(env: NodeJS.ProcessEnv): DeepgramTts {
  return new DeepgramTts({
    apiKey: env.DEEPGRAM_API_KEY,
    model: env.DEEPGRAM_TTS_MODEL ?? "aura-2-draco-en",
    sampleRate: readInteger(env.DEEPGRAM_TTS_SAMPLE_RATE, 24_000),
    timeoutMs: readInteger(env.DEEPGRAM_TTS_TIMEOUT_MS, 10_000),
  });
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDeepgramStreamingMessage(message: string): { type?: string } | undefined {
  try {
    return JSON.parse(message) as { type?: string };
  } catch {
    return undefined;
  }
}

async function toUint8Array(data: unknown): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array();
}
