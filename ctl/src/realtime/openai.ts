import type { CompanyDelegate, CompanyDelegateRequest } from "@alfred/agent";
import type { PanelSignalEvent } from "../panel";
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
  /** Every final input transcript (live meeting speech), retained by ctl. */
  onUtterance?(utterance: MeetingUtterance): void;
  /**
   * Chat-mode events for the screenshare surface: the user's delegated question
   * (text bubble) and Alfred's spoken reply (a voice/waveform bubble that settles
   * when the spoken answer ends). Deterministic forwarding — not a weave.op.
   */
  onChatMessage?(event: ChatMessageEvent): void;
  /**
   * Live left-panel highlight signals for the screenshare surface. ctl emits a
   * `clear` at the start of each addressed turn and `highlight` signals as Alfred
   * touches Meeting Notes / Action Items / an integration, so the panel reflects
   * what was used for the current prompt. Transient (ws-only) side-effect.
   */
  onPanelSignal?(event: PanelSignalEvent): void;
  onAudioStart(id: string, sampleRate: number): void;
  onAudio(bytes: Uint8Array): void;
  onAudioEnd(id: string): void;
  onAudioClear(): void;
  onStartScreenshare(): Promise<void> | void;
  /**
   * Generate meeting notes from the retained transcript and return the bullets
   * to display in the screenshare chat pane.
   */
  onShowMeetingNotes(): Promise<{ notes: string[]; updated: boolean }>;
  /**
   * Generate end-of-meeting action items from the retained transcript and push
   * them to the screenshare chat pane. Returns items for chat rendering.
   */
  onCreateActionItems(): Promise<{
    count: number;
    items: ActionItemForChat[];
  }>;
  /** Add a single action item to the screenshare list (voice "add" command). */
  onAddActionItem(input: { title: string; assignee?: string }): Promise<{
    status: string;
    title?: string;
    items: ActionItemForChat[];
  }>;
  /** Remove the action item matching the description (voice "remove" command). */
  onRemoveActionItem(input: { title: string }): Promise<{
    status: string;
    title?: string;
    items: ActionItemForChat[];
  }>;
  /**
   * Show Alfred-decided generative UI (chart/table) on the screenshare for a
   * free-form request. Delegated: the visual is built by Talon (`buildVisual`)
   * via the agui CopilotKit bridge; ctl only triggers the run. The spoken answer
   * still flows through the Realtime voice path.
   */
  onRenderVisual(input: { question: string; afterTs?: number }): void | Promise<void>;
}

/** Minimal action-item shape for screenshare chat rendering. */
export interface ActionItemForChat {
  title: string;
  assignee: string;
  status?: "open" | "done";
}

/** A chat event ctl forwards to the agui screenshare chat view. */
export interface ChatMessageEvent {
  op: "add" | "update";
  id?: string;
  role?: "user" | "alfred";
  kind?: "text" | "voice";
  text?: string;
  status?: "thinking" | "speaking" | "done";
  /** Epoch ms for timeline ordering on the screenshare chat view. */
  ts?: number;
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
  private readonly onChatMessage?: (event: ChatMessageEvent) => void;
  private readonly onPanelSignal?: (event: PanelSignalEvent) => void;
  private readonly onAudioStart: (id: string, sampleRate: number) => void;
  private readonly onAudio: (bytes: Uint8Array) => void;
  private readonly onAudioEnd: (id: string) => void;
  private readonly onAudioClear: () => void;
  private readonly onStartScreenshare: () => Promise<void> | void;
  private readonly onShowMeetingNotes: OpenAIRealtimeVoiceOptions["onShowMeetingNotes"];
  private readonly onCreateActionItems: () => Promise<{
    count: number;
    items: ActionItemForChat[];
  }>;
  private readonly onAddActionItem: OpenAIRealtimeVoiceOptions["onAddActionItem"];
  private readonly onRemoveActionItem: OpenAIRealtimeVoiceOptions["onRemoveActionItem"];
  private readonly onRenderVisual: OpenAIRealtimeVoiceOptions["onRenderVisual"];
  private readonly queuedAudio: string[] = [];
  private socket?: WebSocket;
  private state: ConnectionState = "idle";
  private isClosed = false;
  private activeAudioId?: string;
  private lastAssistantItemId?: string;
  private lastAudioStartedAt?: number;
  private suppressResponseAudio = false;
  // Mirror of the server's response lifecycle so we never start two responses at
  // once (which fails with conversation_already_has_active_response). Flipped
  // synchronously when we send response.create to close the send->created gap.
  private responseInProgress = false;
  // A response.create requested while one was active, deferred until it finishes.
  private pendingResponseReason?: string;
  private readonly handledFunctionCallIds = new Set<string>();
  private readonly delegateAnswersByQuestion = new Map<string, TimedDelegateAnswer>();
  private readonly delegateInFlightByQuestion = new Map<string, Promise<string>>();
  // The id of the Alfred voice bubble awaiting its spoken answer; settled to
  // "done" when the next non-function-call response finishes (the spoken reply).
  private pendingChatAnswerId?: string;
  // The most recent final user STT, shown verbatim in the chat user bubble (the
  // delegate tool argument is a model reformulation, not what the user said).
  private lastUserTranscript?: string;
  // Playback bookkeeping so Alfred's waveform settles when the meeting audio
  // actually finishes. response.done fires earlier because Realtime streams audio
  // faster than realtime playback, so we estimate the end from the PCM bytes sent.
  private pendingChatAudioStartedAt?: number;
  private pendingChatAudioBytes = 0;
  private pendingChatSettleTimer?: ReturnType<typeof setTimeout>;

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
    this.onChatMessage = options.onChatMessage;
    this.onPanelSignal = options.onPanelSignal;
    this.onAudioStart = options.onAudioStart;
    this.onAudio = options.onAudio;
    this.onAudioEnd = options.onAudioEnd;
    this.onAudioClear = options.onAudioClear;
    this.onStartScreenshare = options.onStartScreenshare;
    this.onShowMeetingNotes = options.onShowMeetingNotes;
    this.onCreateActionItems = options.onCreateActionItems;
    this.onAddActionItem = options.onAddActionItem;
    this.onRemoveActionItem = options.onRemoveActionItem;
    this.onRenderVisual = options.onRenderVisual;
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
    this.responseInProgress = false;
    this.pendingResponseReason = undefined;
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
      // The active/queued response died with the connection; reset so a reconnect
      // can start a fresh response instead of deferring forever.
      this.responseInProgress = false;
      this.pendingResponseReason = undefined;
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
            name: "render_visual",
            description:
              "Show Alfred-decided generative UI on the shared screen: chart, graph, table, or stylized quote. " +
              "PREFERRED for quantitative company data: finances, revenue, expenses, metrics, trends, " +
              "comparisons, breakdowns, quarterly/annual reports, and any question whose best answer is " +
              "numbers in a chart or table — even if the user does not say \"chart\" or \"graph\". " +
              "Also use when they ask to show, pull up, display, visualize, or report data. " +
              "Use for colleague explanations too — e.g. how someone implemented something, or to pull up " +
              "their words from Slack/docs as a quote bubble on screen. " +
              "Alfred picks the representation; you only provide what to visualize.",
            parameters: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description:
                    "A concise standalone description of what to visualize, e.g. \"last quarter's revenue by category\" or \"Q3 finances\".",
                },
              },
              required: ["question"],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "delegate_to_company_agent",
            description:
              "Ask Alfred's Talon-backed delegate for internal company facts from company docs, Slack/project/meeting context, colleague notes, ship-readiness blockers, or current public web lookup. " +
              "Do NOT use for quantitative data (finances, metrics, trends, breakdowns) — use render_visual instead. " +
              "Do NOT use when the user asks how a colleague implemented something or to show their words on screen — use render_visual for a quote bubble.",
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
          {
            type: "function",
            name: "create_action_items",
            description:
              "Generate end-of-meeting action items from the full meeting transcript and show them on the shared screen. Call when a participant asks Alfred to create, generate, or summarize action items, to-dos, follow-ups, or next steps.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "show_meeting_notes",
            description:
              "Generate or refresh Alfred's summarized meeting-note bullets from the meeting transcript and show them in the shared chat pane. Call when a participant asks to see, show, summarize, recap, or update meeting notes.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "add_action_item",
            description:
              "Add a single action item to the shared action-items list. Call when a participant asks Alfred to add, create, or note one specific to-do, task, or follow-up.",
            parameters: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "A concise description of the action item.",
                },
                assignee: {
                  type: "string",
                  description: "Who owns the item, if stated; omit if unknown.",
                },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "remove_action_item",
            description:
              "Remove a single action item from the shared action-items list. Call when a participant asks Alfred to remove, delete, or drop a specific to-do. Provide the title or a short description of the item to remove.",
            parameters: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description:
                    "The title or a short description identifying the action item to remove.",
                },
              },
              required: ["title"],
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
        this.responseInProgress = true;
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
        this.responseInProgress = false;
        this.settlePendingChatAnswer(event.response?.output ?? []);
        await this.handleFunctionCalls(event.response?.output ?? []);
        this.flushPendingResponse();
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

    // Forward all meeting speech (not just wake-word turns) so ctl can build
    // transcript-derived features such as meeting notes and action items.
    this.onUtterance?.({
      text: transcript,
      speaker: this.speaker.displayName,
      ts: Date.now(),
    });

    // An utterance addresses Alfred only when it opens with the wake word,
    // optionally after a short lead-in ("hey alfred", "ok so alfred"). Other speech
    // stays in the Realtime conversation as context but never triggers a response,
    // so saying just "Alfred" won't make Alfred answer earlier chatter — the answer
    // must come from this addressed utterance.
    if (!this.isAddressedToAlfred(normalized)) {
      console.log("[ctl] realtime turn ignored; not addressed to Alfred");
      return;
    }

    // Remember the addressed turn's raw STT so a subsequent delegate shows the
    // user's own words in the chat bubble rather than the model's reformulated
    // delegate question.
    this.lastUserTranscript = transcript.trim();

    // A new prompt to Alfred resets the live panel highlights; whatever Alfred
    // touches during this turn re-lights the relevant rows.
    this.onPanelSignal?.({ op: "clear" });

    this.createAudioResponse("wake word");
  }

  // True when the utterance opens with the wake word, optionally preceded by a few
  // allowed lead-in words ("hey alfred", "ok so alfred"). Rejects mid-sentence
  // mentions ("I asked alfred earlier") so only addressed turns trigger a response.
  private isAddressedToAlfred(normalized: string): boolean {
    const wakeTokens = this.wakeWord.split(" ").filter(Boolean);
    if (wakeTokens.length === 0) return false;
    const tokens = normalized.split(" ").filter(Boolean);

    for (let start = 0; start <= MAX_WAKE_LEAD_IN_WORDS; start += 1) {
      if (start + wakeTokens.length > tokens.length) break;
      if (!tokens.slice(0, start).every(token => WAKE_LEAD_IN_WORDS.has(token))) break;
      if (wakeTokens.every((word, index) => tokens[start + index] === word)) return true;
    }
    return false;
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
      // The spoken answer is now playing — flip the pending chat bubble from
      // "thinking" (dots) to "speaking" (waveform) and start tracking playback.
      if (this.pendingChatAnswerId) {
        this.pendingChatAudioStartedAt = Date.now();
        this.pendingChatAudioBytes = 0;
        this.onChatMessage?.({ op: "update", id: this.pendingChatAnswerId, status: "speaking" });
      }
    }
    const audio = Buffer.from(event.delta, "base64");
    if (this.pendingChatAnswerId) this.pendingChatAudioBytes += audio.length;
    this.onAudio(audio);
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
    // Alfred was cut off — stop the waveform now rather than at the estimated end.
    this.finalizePendingChatAnswerNow();
  }

  private clearPlaybackForToolCall(): void {
    if (!this.activeAudioId) return;
    console.log("[ctl] clearing pre-tool realtime audio");
    this.onAudioClear();
    this.activeAudioId = undefined;
    this.lastAudioStartedAt = undefined;
  }

  // Settle Alfred's pending chat waveform once the spoken answer finishes. The
  // function-call response itself (which carries the delegate output) is skipped so
  // we only act on the subsequent audio reply. response.done fires when generation
  // completes, but the meeting audio keeps playing (it streams faster than
  // realtime), so we schedule the "done" for the estimated playback end instead of
  // settling immediately — otherwise the waveform stops well before Alfred does.
  private settlePendingChatAnswer(output: RealtimeOutputItem[]): void {
    if (!this.pendingChatAnswerId) return;
    if (output.some(item => item.type === "function_call")) return;

    const id = this.pendingChatAnswerId;
    const samples = this.pendingChatAudioBytes / 2; // 16-bit mono PCM
    const durationMs =
      this.outputSampleRate > 0 ? (samples / this.outputSampleRate) * 1000 : 0;
    const startedAt = this.pendingChatAudioStartedAt ?? Date.now();
    // Cover the media page's scheduling lead + silence tail and a little slack so
    // the waveform never cuts off early.
    const PLAYBACK_TAIL_MS = 300;
    const remainingMs = Math.max(0, startedAt + durationMs + PLAYBACK_TAIL_MS - Date.now());

    this.clearPendingChatSettleTimer();
    this.pendingChatSettleTimer = setTimeout(() => {
      this.pendingChatSettleTimer = undefined;
      // Guard against a newer answer having taken over in the meantime.
      if (this.pendingChatAnswerId !== id) return;
      this.finalizePendingChatAnswerNow();
    }, remainingMs);
  }

  // Settle the waveform immediately (playback ended early, e.g. a barge-in
  // interruption truncated Alfred's reply).
  private finalizePendingChatAnswerNow(): void {
    this.clearPendingChatSettleTimer();
    const id = this.pendingChatAnswerId;
    if (!id) return;
    this.pendingChatAnswerId = undefined;
    this.pendingChatAudioStartedAt = undefined;
    this.pendingChatAudioBytes = 0;
    this.onChatMessage?.({ op: "update", id, status: "done" });
  }

  private clearPendingChatSettleTimer(): void {
    if (this.pendingChatSettleTimer) {
      clearTimeout(this.pendingChatSettleTimer);
      this.pendingChatSettleTimer = undefined;
    }
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
          const turnTs = Date.now();
          console.log(`[ctl] realtime delegate question: ${truncateForLog(question, 240)}`);
          // Surface the Q&A on the screenshare chat view immediately, before the
          // (slower) delegate call resolves. Show the user's own words (STT), not the
          // model's reformulated delegate question. Stable ids so the WS push and the
          // catch-up poll dedup to a single bubble.
          this.onChatMessage?.({
            op: "add",
            id: crypto.randomUUID(),
            role: "user",
            kind: "text",
            text: this.lastUserTranscript || question,
            ts: turnTs,
          });
          const alfredId = crypto.randomUUID();
          this.pendingChatAnswerId = alfredId;
          // Start as "thinking" (bouncing dots) while the delegate runs; flipped to
          // "speaking" (waveform) once the spoken answer's audio actually begins.
          this.onChatMessage?.({
            op: "add",
            id: alfredId,
            role: "alfred",
            kind: "voice",
            status: "thinking",
            ts: turnTs + 1,
          });
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
      case "show_meeting_notes": {
        console.log("[ctl] realtime show_meeting_notes");
        const turnTs = Date.now();
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "user",
          kind: "text",
          text: this.lastUserTranscript || "Show meeting notes",
          ts: turnTs,
        });
        this.onPanelSignal?.({ op: "highlight", target: "notes" });
        try {
          const { notes, updated } = await this.onShowMeetingNotes();
          this.onChatMessage?.({
            op: "add",
            id: crypto.randomUUID(),
            role: "alfred",
            kind: "text",
            text: formatMeetingNotesForChat(notes),
            ts: turnTs + 1,
          });
          return { status: "shown", count: notes.length, updated };
        } catch (error) {
          this.onChatMessage?.({
            op: "add",
            id: crypto.randomUUID(),
            role: "alfred",
            kind: "text",
            text: "I couldn't generate meeting notes from the transcript.",
            ts: turnTs + 1,
          });
          return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      case "create_action_items": {
        console.log("[ctl] realtime create_action_items");
        const turnTs = Date.now();
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "user",
          kind: "text",
          text: this.lastUserTranscript || "Create action items",
          ts: turnTs,
        });
        this.onPanelSignal?.({ op: "highlight", target: "tasks" });
        try {
          const { count, items } = await this.onCreateActionItems();
          console.log(`[ctl] realtime create_action_items produced ${count} items`);
          this.onChatMessage?.({
            op: "add",
            id: crypto.randomUUID(),
            role: "alfred",
            kind: "text",
            text: formatActionItemsForChat(items),
            ts: turnTs + 1,
          });
          return { status: "created", count };
        } catch (error) {
          this.onChatMessage?.({
            op: "add",
            id: crypto.randomUUID(),
            role: "alfred",
            kind: "text",
            text: "I couldn't generate action items from the transcript.",
            ts: turnTs + 1,
          });
          return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      case "add_action_item": {
        const args = parseFunctionArgs(item.arguments);
        const title = typeof args.title === "string" ? args.title.trim() : "";
        if (!title) return { status: "failed", error: "An action item title is required." };
        const assignee =
          typeof args.assignee === "string" && args.assignee.trim()
            ? args.assignee.trim()
            : undefined;
        const turnTs = Date.now();
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "user",
          kind: "text",
          text: this.lastUserTranscript || `Add action item: ${title}`,
          ts: turnTs,
        });
        this.onPanelSignal?.({ op: "highlight", target: "tasks" });
        const result = await this.onAddActionItem({ title, assignee });
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "alfred",
          kind: "text",
          text:
            result.status === "added"
              ? formatActionItemsForChat(result.items)
              : "I couldn't add that action item.",
          ts: turnTs + 1,
        });
        return result;
      }
      case "remove_action_item": {
        const args = parseFunctionArgs(item.arguments);
        const title = typeof args.title === "string" ? args.title.trim() : "";
        if (!title) {
          return { status: "failed", error: "Specify which action item to remove." };
        }
        const turnTs = Date.now();
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "user",
          kind: "text",
          text: this.lastUserTranscript || `Remove action item: ${title}`,
          ts: turnTs,
        });
        this.onPanelSignal?.({ op: "highlight", target: "tasks" });
        const result = await this.onRemoveActionItem({ title });
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "alfred",
          kind: "text",
          text:
            result.status === "removed"
              ? formatActionItemsForChat(result.items)
              : result.status === "not_found"
                ? "I couldn't find a matching action item to remove."
                : "I couldn't remove that action item.",
          ts: turnTs + 1,
        });
        return result;
      }
      case "render_visual": {
        const args = parseFunctionArgs(item.arguments);
        const question = typeof args.question === "string" ? args.question.trim() : "";
        if (!question) {
          return { status: "failed", error: "Describe what to visualize." };
        }
        console.log(`[ctl] realtime render_visual: ${truncateForLog(question, 240)}`);
        // Surface the turn on the screenshare chat view (user text + Alfred waveform),
        // then trigger the chart via the CopilotKit agui run. The chart is an additional
        // Alfred-side message that slots into the timeline after the waveform.
        const turnTs = Date.now();
        this.onChatMessage?.({
          op: "add",
          id: crypto.randomUUID(),
          role: "user",
          kind: "text",
          text: this.lastUserTranscript || question,
          ts: turnTs,
        });
        const alfredId = crypto.randomUUID();
        this.pendingChatAnswerId = alfredId;
        this.onChatMessage?.({
          op: "add",
          id: alfredId,
          role: "alfred",
          kind: "voice",
          status: "thinking",
          ts: turnTs + 1,
        });
        try {
          await this.onRenderVisual({ question, afterTs: turnTs + 2 });
          return { status: "rendering" };
        } catch (error) {
          return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
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
    // A response is already active; queue this one and let the active response
    // finish. Single-slot queue: the latest requested turn wins.
    if (this.responseInProgress) {
      console.log(`[ctl] realtime response.create deferred (busy) reason=${reason}`);
      this.pendingResponseReason = reason;
      return;
    }
    // Mark in-progress synchronously so a concurrent turn defers rather than
    // racing the response.created event.
    this.responseInProgress = true;
    console.log(`[ctl] realtime response.create reason=${reason}`);
    this.send({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: responseInstructions(
          reason,
          reason === "wake word" ? this.lastUserTranscript : undefined,
        ),
      },
    });
  }

  private flushPendingResponse(): void {
    const reason = this.pendingResponseReason;
    if (!reason) return;
    this.pendingResponseReason = undefined;
    console.log(`[ctl] realtime flushing deferred response reason=${reason}`);
    this.createAudioResponse(reason);
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

# Visuals (prefer for numbers and on-screen quotes)
When a question involves company metrics, finances, revenue, expenses, trends, comparisons, breakdowns, quarterly/annual figures, or any data best shown as a chart or table, call render_visual — even if the user only asks "what were…", "how did we do…", or "pull up the report" without saying "chart". Examples: quarterly finances, revenue by category, net income over time. Call ONLY render_visual for that request (not delegate_to_company_agent). Alfred picks the chart/table and it renders on the shared screen. After the tool returns you may give a brief spoken intro (one sentence); the chart carries the detail — do not read out every number.
When the user asks how a colleague implemented something, or to show/pull up someone's explanation from Slack or docs (e.g. "how did Shukant wire CopilotKit and Recall?"), call render_visual so Alfred can render their words as a quote bubble on screen — not delegate_to_company_agent.

# Delegation
Call delegate_to_company_agent for non-quantitative factual questions: colleague notes, ship readiness, blockers, project status, Slack context, policy/docs prose, or current public web lookup. Do not use delegate for finances, metrics, or other numeric data — use render_visual instead. For delegated questions, do not speak before the tool result is available. Call the tool at most once for a user question, then answer using that result. The delegation result is authoritative. If it says context is missing, say that plainly.

# Screenshare
When the user asks Alfred to share the screen, show the screen, present, or start screenshare, call start_screenshare. Confirm briefly after the tool returns.

# Meeting notes
When the user asks to see meeting notes, summarize the meeting, recap what has happened, or update notes, call show_meeting_notes. The notes render in the shared chat pane. After the tool returns, confirm briefly how many bullets are shown.

# Action items
When the user asks Alfred to create, generate, or summarize action items, to-dos, follow-ups, or next steps, call create_action_items. The items render in the shared chat pane. After the tool returns, confirm briefly how many were captured. To add one specific item, call add_action_item with a concise title and an assignee if one was stated. To remove one, call remove_action_item with the title or a short description of the item. After an add or remove, confirm briefly; if a remove returns not_found, say you could not find a matching item.

# Voice Style
Be concise, natural, and direct. Speak at a brisk conversational pace, not slowly. Answer in one sentence by default, two only when necessary. Do not add filler, throat-clearing, long acknowledgements, or tool-use preambles.

# Guardrails
Do not claim access to private company information unless it came from the delegation result. Do not perform side effects without explicit confirmation.`;
}

function responseInstructions(reason: string, addressedText?: string): string {
  if (reason === "function output") {
    return "Answer the user using only the available function output. Do not call another tool. Be concise and direct.";
  }

  const base =
    "If the request is about company metrics, finances, trends, or numeric breakdowns, call render_visual (not delegate_to_company_agent). " +
    "If it asks how a colleague implemented something or to show their words on screen, call render_visual for a quote (not delegate_to_company_agent). " +
    "If the request asks for meeting notes or a meeting recap, call show_meeting_notes. " +
    "If it needs other internal company context or current public information, call delegate_to_company_agent. " +
    "Call the chosen tool silently and do not produce spoken content before the tool result. Otherwise answer concisely by voice.";
  const addressed = addressedText?.trim();
  if (addressed) {
    return `The user just addressed you with: "${addressed}". Respond only to this latest addressed request; do not answer earlier questions that were not addressed to you. If it contains no actual request, briefly ask how you can help. ${base}`;
  }
  return base;
}

function formatMeetingNotesForChat(notes: string[]): string {
  if (notes.length === 0) {
    return "Meeting notes\n\nNo substantive meeting notes yet.";
  }
  return `Meeting notes\n\n${notes.map(note => `- ${note}`).join("\n")}`;
}

function formatActionItemsForChat(items: ActionItemForChat[]): string {
  if (items.length === 0) {
    return "Action items\n\nNo action items yet.";
  }
  return `Action items\n\n${items
    .map(item => {
      const assignee = item.assignee.trim() ? ` (${item.assignee})` : "";
      const done = item.status === "done" ? " ✓" : "";
      return `- ${item.title}${assignee}${done}`;
    })
    .join("\n")}`;
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

// Filler words allowed before the wake word so "hey alfred" / "ok so alfred" still
// address Alfred. Kept short and conversational to avoid matching real sentences.
const WAKE_LEAD_IN_WORDS = new Set([
  "hey",
  "hi",
  "hello",
  "ok",
  "okay",
  "yo",
  "um",
  "uh",
  "so",
  "well",
  "there",
]);
// Max lead-in tokens scanned before the wake word (covers "hey there alfred").
const MAX_WAKE_LEAD_IN_WORDS = 3;

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
