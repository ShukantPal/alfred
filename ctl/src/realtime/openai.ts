import type { CompanyDelegate, CompanyDelegateRequest } from "@alfred/agent";
import type { MeetingUtterance } from "../transcript";

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
  meetingId: string;
  speaker: CompanyDelegateRequest["speaker"];
  delegate: CompanyDelegate;
  onStatus(message: string): void;
  /** Every final input transcript (live meeting speech), for meeting-notes forwarding. */
  onUtterance?(utterance: MeetingUtterance): void;
  onAudioStart(id: string, sampleRate: number): void;
  onAudio(bytes: Uint8Array): void;
  onAudioEnd(id: string): void;
  onAudioClear(): void;
  onStartScreenshare(): Promise<void> | void;
}

type ConnectionState = "idle" | "connecting" | "open" | "ready" | "closed";

interface RealtimeEvent {
  type?: string;
  delta?: string;
  response?: {
    id?: string;
    status?: string;
    status_details?: unknown;
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

interface TimedDelegateAnswer {
  answer: string;
  expiresAt: number;
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
  private readonly realtimeInputSampleRate: number;
  private readonly outputSampleRate: number;
  private readonly safetyIdentifier?: string;
  private readonly meetingId: string;
  private readonly speaker: CompanyDelegateRequest["speaker"];
  private readonly delegate: CompanyDelegate;
  private readonly onStatus: (message: string) => void;
  private readonly onUtterance?: (utterance: MeetingUtterance) => void;
  private readonly onAudioStart: (id: string, sampleRate: number) => void;
  private readonly onAudio: (bytes: Uint8Array) => void;
  private readonly onAudioEnd: (id: string) => void;
  private readonly onAudioClear: () => void;
  private readonly onStartScreenshare: () => Promise<void> | void;
  private readonly queuedAudio: string[] = [];
  private socket?: WebSocket;
  private state: ConnectionState = "idle";
  private isClosed = false;
  private activeAudioId?: string;
  private lastAssistantItemId?: string;
  private lastAudioStartedAt?: number;
  private suppressResponseAudio = false;
  private readonly handledFunctionCallIds = new Set<string>();
  private readonly delegateAnswersByQuestion = new Map<string, TimedDelegateAnswer>();
  private readonly delegateInFlightByQuestion = new Map<string, Promise<string>>();

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
    this.realtimeInputSampleRate = Math.max(24_000, options.inputSampleRate);
    this.outputSampleRate = options.outputSampleRate;
    this.safetyIdentifier = options.safetyIdentifier;
    this.meetingId = options.meetingId;
    this.speaker = options.speaker;
    this.delegate = options.delegate;
    this.onStatus = options.onStatus;
    this.onUtterance = options.onUtterance;
    this.onAudioStart = options.onAudioStart;
    this.onAudio = options.onAudio;
    this.onAudioEnd = options.onAudioEnd;
    this.onAudioClear = options.onAudioClear;
    this.onStartScreenshare = options.onStartScreenshare;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  sendPcm(audio: Uint8Array): void {
    if (this.isClosed || !this.apiKey || audio.byteLength === 0) return;
    this.ensureConnected();
    const realtimeAudio =
      this.inputSampleRate === this.realtimeInputSampleRate
        ? audio
        : resamplePcm16(audio, this.inputSampleRate, this.realtimeInputSampleRate);
    const encoded = Buffer.from(realtimeAudio).toString("base64");
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
              rate: this.realtimeInputSampleRate,
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
              rate: this.outputSampleRate,
            },
            voice: this.voice,
          },
        },
        tools: [
          {
            type: "function",
            name: "delegate_to_company_agent",
            description:
              "Ask Alfred's Talon-backed delegate for internal company facts from company docs, Slack/project/meeting context, or for current public web lookup when needed.",
            parameters: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description:
                    "A concise standalone question for the delegate, including whether it needs company context or public web context.",
                },
              },
              required: ["question"],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "start_screenshare",
            description:
              "Start Alfred's meeting screenshare output media when the user explicitly asks Alfred to share or show the screen.",
            parameters: {
              type: "object",
              properties: {},
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
        interrupt_response: false,
      };
    }

    return {
      type: "semantic_vad",
      eagerness: this.semanticVadEagerness,
      create_response: false,
      interrupt_response: false,
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
      case "response.created":
        this.suppressResponseAudio = false;
        console.log("[ctl] realtime response created");
        return;
      case "conversation.item.input_audio_transcription.completed":
        this.handleInputTranscript(event.transcript ?? "");
        return;
      case "input_audio_buffer.speech_started":
        console.log("[ctl] realtime speech started");
        this.clearPlaybackForInterruption();
        return;
      case "response.output_item.added":
        if (event.item?.type) {
          console.log(`[ctl] realtime response output item ${event.item.type}${event.item.name ? `:${event.item.name}` : ""}`);
        }
        if (event.item?.type === "function_call") {
          this.suppressResponseAudio = true;
          this.clearPlaybackForToolCall();
        }
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
        console.log(
          `[ctl] realtime response done status=${event.response?.status ?? "unknown"} outputs=${summarizeResponseOutput(event.response?.output ?? [])}`,
        );
        if (event.response?.status_details) {
          console.log("[ctl] realtime response status details", event.response.status_details);
        }
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

    // Forward all meeting speech (not just wake-word turns) for live meeting notes.
    this.onUtterance?.({
      text: transcript,
      speaker: this.speaker.displayName,
      ts: Date.now(),
    });

    if (!normalized.includes(this.wakeWord)) {
      console.log("[ctl] realtime turn ignored; wake word not present");
      return;
    }

    this.createAudioResponse("wake word");
  }

  private flushQueuedAudio(): void {
    while (this.queuedAudio.length > 0 && this.state === "ready") {
      const audio = this.queuedAudio.shift();
      if (audio) this.send({ type: "input_audio_buffer.append", audio });
    }
  }

  private handleAudioDelta(event: RealtimeEvent): void {
    if (!event.delta || this.suppressResponseAudio) return;
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

  private clearPlaybackForToolCall(): void {
    if (!this.activeAudioId) return;
    console.log("[ctl] clearing pre-tool realtime audio");
    this.onAudioClear();
    this.activeAudioId = undefined;
    this.lastAudioStartedAt = undefined;
  }

  private async handleFunctionCalls(items: RealtimeOutputItem[]): Promise<void> {
    let handledAny = false;
    let handledDelegate = false;
    for (const item of items) {
      if (item.type !== "function_call") continue;

      const callId = item.call_id;
      if (!callId) continue;
      if (this.handledFunctionCallIds.has(callId)) {
        console.log(`[ctl] realtime function call already handled call_id=${callId}`);
        continue;
      }
      this.handledFunctionCallIds.add(callId);

      if (item.name === "delegate_to_company_agent" && handledDelegate) {
        console.log(
          `[ctl] realtime duplicate delegate call skipped call_id=${callId} args=${truncateForLog(item.arguments ?? "", 240)}`,
        );
        this.sendFunctionOutput(callId, {
          status: "skipped",
          reason:
            "Duplicate delegate_to_company_agent call in the same response. Use the first delegate result.",
        });
        handledAny = true;
        continue;
      }
      if (item.name === "delegate_to_company_agent") {
        handledDelegate = true;
      }

      const output = await this.handleFunctionCallSafely(item);
      this.sendFunctionOutput(callId, output);
      handledAny = true;
    }

    if (handledAny) {
      this.createAudioResponse("function output");
    }
  }

  private async handleFunctionCallSafely(item: RealtimeOutputItem): Promise<Record<string, unknown>> {
    try {
      return await this.handleFunctionCall(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ctl] realtime function ${item.name ?? "<missing>"} failed`, error);
      return {
        status: "failed",
        error: message,
      };
    }
  }

  private async handleFunctionCall(item: RealtimeOutputItem): Promise<Record<string, unknown>> {
    switch (item.name) {
      case "delegate_to_company_agent": {
        const args = parseFunctionArgs(item.arguments);
        const question = typeof args.question === "string" ? args.question.trim() : "";
        if (question) {
          console.log(`[ctl] realtime delegate question: ${truncateForLog(question, 240)}`);
        }
        const answer = question ? await this.askDelegateOnce(question) : "No question was provided for delegation.";
        console.log(
          `[ctl] realtime delegate answer ${answer.length} chars: ${truncateForLog(answer, 320)}`,
        );
        return { answer };
      }
      case "start_screenshare":
        try {
          await this.onStartScreenshare();
          return { status: "started" };
        } catch (error) {
          return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      default:
        return {
          status: "ignored",
          error: `Unknown function call: ${item.name ?? "<missing>"}`,
        };
    }
  }

  private async askDelegateOnce(question: string): Promise<string> {
    const cacheKey = normalizeDelegateQuestion(question);
    const now = Date.now();
    const cached = this.delegateAnswersByQuestion.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      console.log("[ctl] realtime delegate cache hit");
      return cached.answer;
    }

    const existing = this.delegateInFlightByQuestion.get(cacheKey);
    if (existing) {
      console.log("[ctl] realtime delegate call already in flight");
      return existing;
    }

    const request = this.delegate
      .ask({
        meetingId: this.meetingId,
        speaker: this.speaker,
        question,
      })
      .then(answer => {
        this.delegateAnswersByQuestion.set(cacheKey, {
          answer,
          expiresAt: Date.now() + 60_000,
        });
        return answer;
      })
      .finally(() => {
        this.delegateInFlightByQuestion.delete(cacheKey);
        this.pruneDelegateAnswerCache();
      });

    this.delegateInFlightByQuestion.set(cacheKey, request);
    return request;
  }

  private pruneDelegateAnswerCache(): void {
    const now = Date.now();
    for (const [key, value] of this.delegateAnswersByQuestion) {
      if (value.expiresAt <= now) this.delegateAnswersByQuestion.delete(key);
    }
  }

  private sendFunctionOutput(callId: string, output: Record<string, unknown>): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
  }

  private createAudioResponse(reason: string): void {
    console.log(`[ctl] realtime response.create reason=${reason}`);
    this.send({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: responseInstructions(reason),
      },
    });
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
    voice: env.OPENAI_REALTIME_VOICE ?? "cedar",
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

function defaultInstructions(): string {
  return `You are Alfred, a concise voice assistant in a live meeting. You can help with ordinary questions, meeting discussion, reasoning, and company-context lookups.

# Addressing
Only speak when someone directly addresses Alfred or clearly asks the meeting bot for help. If people are talking to each other, stay silent.

# Answering
Answer normal addressed questions directly when you can do so without private company context or current external lookup.

# Delegation
Call delegate_to_company_agent for factual questions that need internal company docs, Slack/project/meeting context, colleague notes, or current public web lookup. For delegated questions, do not speak before the tool result is available. Call the tool at most once for a user question, then answer using that result. The delegation result is authoritative. If it says context is missing, say that plainly.

# Screenshare
When the user asks Alfred to share the screen, show the screen, present, or start screenshare, call start_screenshare. Confirm briefly after the tool returns.

# Voice Style
Be concise, natural, and direct. Speak at a brisk conversational pace, not slowly. Answer in one sentence by default, two only when necessary. Do not add filler, throat-clearing, long acknowledgements, or tool-use preambles.

# Guardrails
Do not claim access to private company information unless it came from the delegation result. Do not perform side effects without explicit confirmation.`;
}

function responseInstructions(reason: string): string {
  if (reason === "function output") {
    return "Answer the user using only the available function output. Do not call another tool. Be concise and direct.";
  }

  return "If the user's request needs internal company context or current public information, call the appropriate tool silently and do not produce spoken content before the tool result. Otherwise answer concisely by voice.";
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

function summarizeResponseOutput(items: RealtimeOutputItem[]): string {
  if (items.length === 0) return "none";
  return items
    .map(item => `${item.type ?? "unknown"}${item.name ? `:${item.name}` : ""}`)
    .join(",");
}

function truncateForLog(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function resamplePcm16(audio: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate <= 0 || toRate <= 0 || fromRate === toRate || audio.byteLength < 2) return audio;

  const inputLength = Math.floor(audio.byteLength / 2);
  const outputLength = Math.max(1, Math.round((inputLength * toRate) / fromRate));
  const input = new DataView(audio.buffer, audio.byteOffset, inputLength * 2);
  const output = new Uint8Array(outputLength * 2);
  const outputView = new DataView(output.buffer);
  const ratio = fromRate / toRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, inputLength - 1);
    const fraction = sourceIndex - leftIndex;
    const left = input.getInt16(leftIndex * 2, true);
    const right = input.getInt16(rightIndex * 2, true);
    outputView.setInt16(index * 2, Math.round(left + (right - left) * fraction), true);
  }

  return output;
}

function normalizeWakeWord(value: string): string {
  return normalizeText(value) || "alfred";
}

function normalizeDelegateQuestion(value: string): string {
  return normalizeText(value) || value.trim().toLowerCase();
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
