export interface DeepgramTtsOptions {
  apiKey?: string;
  model: string;
  encoding: string;
  container: string;
  sampleRate: number;
  timeoutMs: number;
}

export interface TtsAudio {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  provider: string;
}

export class DeepgramTts {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly encoding: string;
  private readonly container: string;
  private readonly sampleRate: number;
  private readonly timeoutMs: number;

  constructor(options: DeepgramTtsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.encoding = options.encoding;
    this.container = options.container;
    this.sampleRate = options.sampleRate;
    this.timeoutMs = options.timeoutMs;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async synthesize(text: string): Promise<TtsAudio> {
    if (!this.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not set.");
    }

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.timeoutMs);

    try {
      const url = new URL("https://api.deepgram.com/v1/speak");
      url.searchParams.set("model", this.model);
      url.searchParams.set("encoding", this.encoding);
      url.searchParams.set("container", this.container);
      url.searchParams.set("sample_rate", String(this.sampleRate));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.text();
        throw new Error(
          `Deepgram TTS failed: ${response.status} ${response.statusText}\n${body}`,
        );
      }

      return {
        body: response.body,
        contentType: response.headers.get("content-type") ?? "audio/mpeg",
        provider: "deepgram",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createDeepgramTtsFromEnv(env: NodeJS.ProcessEnv): DeepgramTts {
  return new DeepgramTts({
    apiKey: env.DEEPGRAM_API_KEY,
    model: env.DEEPGRAM_TTS_MODEL ?? "aura-2-draco-en",
    encoding: env.DEEPGRAM_TTS_ENCODING ?? "linear16",
    container: env.DEEPGRAM_TTS_CONTAINER ?? "wav",
    sampleRate: readInteger(env.DEEPGRAM_TTS_SAMPLE_RATE, 24_000),
    timeoutMs: readInteger(env.DEEPGRAM_TTS_TIMEOUT_MS, 10_000),
  });
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
