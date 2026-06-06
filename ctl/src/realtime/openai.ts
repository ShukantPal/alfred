import type { AgentClient, AgentSpeaker } from "../agent/client";

export interface OpenAIRealtimeVoiceOptions {
  apiKey?: string;
  model: string;
  voice: string;
  instructions: string;
  reasoningEffort: string;
  transcriptionModel: string;
  wakeWord: string;
  noiseReduction: "near_field" | "far_field" | "none";
  vadType: "semantic_vad" | "server_vad";
  vadThreshold: number;
  vadSilenceDurationMs: number;
  vadPrefixPaddingMs: number;
  semanticVadEagerness: "low" | "medium" | "high" | "auto";
  inputSampleRate: number;
  outputSampleRate: number;
  safetyIdentifier?: string;
  speaker: AgentSpeaker;
  agent: AgentClient;
  onStatus(message: string): void;
  onAudioStart(id: string, sampleRate: number): void;
  onAudio(bytes: Uint8Array): void;
  onAudioEnd(id: string): void;
  onAudioClear(): void;
}

type ConnectionState = "idle" | "connecting" | "open" | "ready" | "closed";

interface RealtimeEvent {
  type?: string;
  delta?: string;
  response?: {
    id?: string;
    output?: RealtimeOutputItem[];
  };
  response_id?: string;
  item_id?: string;
  transcript?: string;
  item?: RealtimeOutputItem;
  error?: {
    message?: string;
    code?: string;
  };
}

interface RealtimeOutputItem {
  id?: string;
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
}

export class OpenAIRealtimeVoice {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly instructions: string;
  private readonly reasoningEffort: string;
  private readonly transcriptionModel: string;
  private readonly wakeWord: string;
  private readonly noiseReduction: OpenAIRealtimeVoiceOptions["noiseReduction"];
  private readonly vadType: OpenAIRealtimeVoiceOptions["vadType"];
  private readonly vadThreshold: number;
  private readonly vadSilenceDurationMs: number;
  private readonly vadPrefixPaddingMs: number;
  private readonly semanticVadEagerness: OpenAIRealtimeVoiceOptions["semanticVadEagerness"];
  private readonly inputSampleRate: number;
  private readonly outputSampleRate: number;
  private readonly safetyIdentifier?: string;
  private readonly speaker: AgentSpeaker;
  private readonly agent: AgentClient;
  private readonly onStatus: (message: string) => void;
  private readonly onAudioStart: (id: string, sampleRate: number) => void;
  private readonly onAudio: (bytes: Uint8Array) => void;
  private readonly onAudioEnd: (id: string) => void;
  private readonly onAudioClear: () => void;
  private readonly queuedAudio: string[] = [];
  private socket?: WebSocket;
  private state: ConnectionState = "idle";
  private isClosed = false;
  private activeAudioId?: string;
  private lastAssistantItemId?: string;
  private lastAudioStartedAt?: number;

  constructor(options: OpenAIRealtimeVoiceOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.voice = options.voice;
    this.instructions = options.instructions;
    this.reasoningEffort = options.reasoningEffort;
    this.transcriptionModel = options.transcriptionModel;
    this.wakeWord = normalizeWakeWord(options.wakeWord);
    this.noiseReduction = options.noiseReduction;
    this.vadType = options.vadType;
    this.vadThreshold = options.vadThreshold;
    this.vadSilenceDurationMs = options.vadSilenceDurationMs;
    this.vadPrefixPaddingMs = options.vadPrefixPaddingMs;
    this.semanticVadEagerness = options.semanticVadEagerness;
    this.inputSampleRate = options.inputSampleRate;
    this.outputSampleRate = options.outputSampleRate;
    this.safetyIdentifier = options.safetyIdentifier;
    this.speaker = options.speaker;
    this.agent = options.agent;
    this.onStatus = options.onStatus;
    this.onAudioStart = options.onAudioStart;
    this.onAudio = options.onAudio;
    this.onAudioEnd = options.onAudioEnd;
    this.onAudioClear = options.onAudioClear;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  sendPcm(audio: Uint8Array): void {
    if (this.isClosed || !this.apiKey || audio.byteLength === 0) return;
    this.ensureConnected();
    const encoded = Buffer.from(audio).toString("base64");
    if (this.state !== "ready") {
      this.queuedAudio.push(encoded);
      if (this.queuedAudio.length > 250) this.queuedAudio.shift();
      return;
    }
    this.send({ type: "input_audio_buffer.append", audio: encoded });
  }

  close(): void {
    this.isClosed = true;
    this.state = "closed";
    this.socket?.close();
    this.socket = undefined;
    this.queuedAudio.length = 0;
  }

  private ensureConnected(): void {
    if (
      this.isClosed ||
      !this.apiKey ||
      this.state === "connecting" ||
      this.state === "open" ||
      this.state === "ready"
    ) {
      return;
    }

    const url = new URL("wss://api.openai.com/v1/realtime");
    url.searchParams.set("model", this.model);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.safetyIdentifier) {
      headers["OpenAI-Safety-Identifier"] = this.safetyIdentifier;
    }

    this.state = "connecting";
    this.onStatus("connecting realtime voice");
    console.log(`[ctl] OpenAI Realtime connecting model=${this.model}`);

    const socket = new WebSocket(url, { headers } as unknown as string[]);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.state = "open";
      this.onStatus("configuring realtime voice");
      this.sendSessionUpdate();
    });

    socket.addEventListener("message", event => {
      const payload = parseRealtimeEvent(event.data);
      if (payload) void this.handleEvent(payload);
    });

    socket.addEventListener("close", event => {
      if (this.isClosed) return;
      this.state = "idle";
      this.socket = undefined;
      this.activeAudioId = undefined;
      this.onStatus("realtime voice disconnected");
      console.log(`[ctl] OpenAI Realtime disconnected code=${event.code}`);
    });

    socket.addEventListener("error", event => {
      this.onStatus("realtime voice error");
      console.error("[ctl] OpenAI Realtime websocket error", event);
    });
  }

  private sendSessionUpdate(): void {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.model,
        output_modalities: ["audio"],
        instructions: this.instructions,
        reasoning: {
          effort: this.reasoningEffort,
        },
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: this.inputSampleRate,
            },
            ...(this.noiseReduction === "none"
              ? {}
              : {
                  noise_reduction: {
                    type: this.noiseReduction,
                  },
                }),
            transcription: {
              model: this.transcriptionModel,
              language: "en",
            },
            turn_detection: this.buildTurnDetection(),
          },
          output: {
            format: {
              type: "audio/pcm",
            },
            voice: this.voice,
          },
        },
        tools: [
          {
            type: "function",
            name: "delegate_to_company_agent",
            description:
              "Ask Alfred's company-memory subdelegation agent for factual answers from seeded company docs, Slack context, project memory, and meeting context.",
            parameters: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description:
                    "A concise standalone question for the company-memory agent.",
                },
              },
              required: ["question"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: "auto",
      },
    });
  }

  private buildTurnDetection(): object {
    if (this.vadType === "server_vad") {
      return {
        type: "server_vad",
        threshold: this.vadThreshold,
        prefix_padding_ms: this.vadPrefixPaddingMs,
        silence_duration_ms: this.vadSilenceDurationMs,
        create_response: false,
        interrupt_response: true,
      };
    }

    return {
      type: "semantic_vad",
      eagerness: this.semanticVadEagerness,
      create_response: false,
      interrupt_response: true,
    };
  }

  private async handleEvent(event: RealtimeEvent): Promise<void> {
    switch (event.type) {
      case "session.created":
        return;
      case "session.updated":
        this.state = "ready";
        this.onStatus("realtime voice ready");
        this.flushQueuedAudio();
        return;
      case "conversation.item.input_audio_transcription.completed":
        this.handleInputTranscript(event.transcript ?? "");
        return;
      case "input_audio_buffer.speech_started":
        this.clearPlaybackForInterruption();
        return;
      case "response.output_audio.delta":
      case "response.audio.delta":
        this.handleAudioDelta(event);
        return;
      case "response.output_audio.done":
      case "response.audio.done":
        this.endActiveAudio(event.response_id);
        return;
      case "response.output_item.done":
        if (event.item?.type === "message" && event.item.id) {
          this.lastAssistantItemId = event.item.id;
        }
        return;
      case "response.done":
        this.endActiveAudio(event.response?.id);
        await this.handleFunctionCalls(event.response?.output ?? []);
        return;
      case "error":
        this.onStatus(`realtime error: ${event.error?.message ?? "unknown"}`);
        console.error("[ctl] OpenAI Realtime error", event.error ?? event);
        return;
    }
  }

  private handleInputTranscript(transcript: string): void {
    const normalized = normalizeText(transcript);
    if (!normalized) return;

    console.log(`[ctl] realtime transcript: ${transcript}`);
    this.onStatus(`heard: ${transcript}`);

    if (!normalized.includes(this.wakeWord)) {
      console.log("[ctl] realtime turn ignored; wake word not present");
      return;
    }

    this.send({ type: "response.create" });
  }

  private flushQueuedAudio(): void {
    while (this.queuedAudio.length > 0 && this.state === "ready") {
      const audio = this.queuedAudio.shift();
      if (audio) this.send({ type: "input_audio_buffer.append", audio });
    }
  }

  private handleAudioDelta(event: RealtimeEvent): void {
    if (!event.delta) return;
    const id = event.response_id ?? this.activeAudioId ?? crypto.randomUUID();
    if (!this.activeAudioId) {
      this.activeAudioId = id;
      this.lastAudioStartedAt = Date.now();
      this.onAudioStart(id, this.outputSampleRate);
    }
    this.onAudio(Buffer.from(event.delta, "base64"));
  }

  private endActiveAudio(responseId?: string): void {
    if (!this.activeAudioId) return;
    if (responseId && responseId !== this.activeAudioId) return;
    this.onAudioEnd(this.activeAudioId);
    this.activeAudioId = undefined;
    this.lastAudioStartedAt = undefined;
  }

  private clearPlaybackForInterruption(): void {
    if (!this.activeAudioId) return;
    this.onAudioClear();
    if (this.lastAssistantItemId && this.lastAudioStartedAt) {
      this.send({
        type: "conversation.item.truncate",
        item_id: this.lastAssistantItemId,
        content_index: 0,
        audio_end_ms: Math.max(0, Date.now() - this.lastAudioStartedAt),
      });
    }
    this.activeAudioId = undefined;
    this.lastAudioStartedAt = undefined;
  }

  private async handleFunctionCalls(items: RealtimeOutputItem[]): Promise<void> {
    let handledAny = false;
    for (const item of items) {
      if (item.type !== "function_call" || item.name !== "delegate_to_company_agent") {
        continue;
      }

      const callId = item.call_id;
      if (!callId) continue;

      const args = parseFunctionArgs(item.arguments);
      const question = typeof args.question === "string" ? args.question.trim() : "";
      const output = question
        ? await askAgent(this.agent, question, this.speaker)
        : "No question was provided for delegation.";

      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            answer: output,
          }),
        },
      });
      handledAny = true;
    }

    if (handledAny) {
      this.send({ type: "response.create" });
    }
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }
}

export function createOpenAIRealtimeVoiceFromEnv(
  env: NodeJS.ProcessEnv,
  options: Omit<
    OpenAIRealtimeVoiceOptions,
    | "apiKey"
    | "model"
    | "voice"
    | "instructions"
    | "reasoningEffort"
    | "transcriptionModel"
    | "wakeWord"
    | "noiseReduction"
    | "vadType"
    | "vadThreshold"
    | "vadSilenceDurationMs"
    | "vadPrefixPaddingMs"
    | "semanticVadEagerness"
    | "inputSampleRate"
    | "outputSampleRate"
    | "safetyIdentifier"
  >,
): OpenAIRealtimeVoice {
  return new OpenAIRealtimeVoice({
    ...options,
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2",
    voice: env.OPENAI_REALTIME_VOICE ?? "marin",
    instructions: env.OPENAI_REALTIME_INSTRUCTIONS ?? defaultInstructions(),
    reasoningEffort: env.OPENAI_REALTIME_REASONING_EFFORT ?? "low",
    transcriptionModel: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe",
    wakeWord: env.ALFRED_WAKE_WORD ?? "alfred",
    noiseReduction: readNoiseReduction(env.OPENAI_REALTIME_NOISE_REDUCTION),
    vadType: readVadType(env.OPENAI_REALTIME_VAD_TYPE),
    vadThreshold: readNumber(env.OPENAI_REALTIME_VAD_THRESHOLD, 0.7),
    vadSilenceDurationMs: readInteger(env.OPENAI_REALTIME_VAD_SILENCE_MS, 700),
    vadPrefixPaddingMs: readInteger(env.OPENAI_REALTIME_VAD_PREFIX_PADDING_MS, 300),
    semanticVadEagerness: readSemanticVadEagerness(env.OPENAI_REALTIME_SEMANTIC_VAD_EAGERNESS),
    inputSampleRate: readInteger(env.OPENAI_REALTIME_INPUT_SAMPLE_RATE, 16_000),
    outputSampleRate: readInteger(env.OPENAI_REALTIME_OUTPUT_SAMPLE_RATE, 24_000),
    safetyIdentifier: env.OPENAI_SAFETY_IDENTIFIER,
  });
}

function askAgent(agent: AgentClient, question: string, speaker: AgentSpeaker): Promise<string> {
  return new Promise(resolve => {
    let answer = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("The company-memory agent timed out before returning an answer.");
    }, 20_000);

    agent.ask(question, speaker, {
      onDelta(delta) {
        answer += delta;
      },
      onDone() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(answer.trim() || "The company-memory agent returned no answer.");
      },
      onError(message) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(`The company-memory agent failed: ${message}`);
      },
      onTrace(node, event, detail) {
        console.log(`[ctl] delegation trace ${node}:${event}${detail ? ` - ${detail}` : ""}`);
      },
    });
  });
}

function defaultInstructions(): string {
  return `You are Alfred, a meeting-native company agent. You listen in a live meeting and respond by voice.

# Addressing
Only speak when someone directly addresses Alfred or clearly asks the meeting bot for help. If people are talking to each other, stay silent.

# Company Memory Delegation
For factual questions about company docs, Slack/project context, call delegate_to_company_agent before answering. The delegation result is authoritative. If it says context is missing, say that plainly.

# Voice Style
Be concise, natural, and direct. Speak at a brisk conversational pace, not slowly. Answer in one sentence by default, two only when necessary. Do not add filler, throat-clearing, or long acknowledgements. If you need the delegation tool, use only a short preamble like "Let me check."

# Guardrails
Do not claim access to real private documents beyond the mocked seeded context. Do not perform side effects without explicit confirmation.`;
}

function parseRealtimeEvent(data: unknown): RealtimeEvent | undefined {
  try {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as RealtimeEvent) : undefined;
  } catch {
    return undefined;
  }
}

function parseFunctionArgs(args: string | undefined): Record<string, unknown> {
  if (!args) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeWakeWord(value: string): string {
  return normalizeText(value) || "alfred";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readNoiseReduction(value: string | undefined): OpenAIRealtimeVoiceOptions["noiseReduction"] {
  if (value === "far_field" || value === "none") return value;
  return "near_field";
}

function readVadType(value: string | undefined): OpenAIRealtimeVoiceOptions["vadType"] {
  if (value === "server_vad") return "server_vad";
  return "semantic_vad";
}

function readSemanticVadEagerness(
  value: string | undefined,
): OpenAIRealtimeVoiceOptions["semanticVadEagerness"] {
  if (value === "low" || value === "high" || value === "auto") return value;
  return "medium";
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
