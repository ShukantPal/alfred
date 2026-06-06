import type { AgentClient, AgentSpeaker } from "./agent/client";

export interface TranscriptCommand {
  type: "status" | "say" | "start_screenshare";
  message?: string;
  text?: string;
}

interface TranscriptResponderOptions {
  broadcast(command: TranscriptCommand): void;
  /** When provided, addressed utterances are answered by the agent/ harness (else greeting). */
  agent?: AgentClient;
  /** Who we attribute meeting speech to when asking the agent. */
  speaker?: AgentSpeaker;
}

export function createTranscriptResponder(options: TranscriptResponderOptions) {
  const recentResponses = new Map<string, number>();
  const speaker = options.speaker ?? { id: "meeting", displayName: "Participant" };
  let agentBusy = false;

  return {
    handle(payload: unknown, source: string) {
      const text = extractTranscriptText(payload);
      if (!text) return;

      console.log(`[ctl] transcript ${source}: ${text}`);
      options.broadcast({ type: "status", message: `heard: ${text}` });

      const normalized = normalizeText(text);
      if (isStartScreenshareCommand(normalized)) {
        if (wasRecentlyHandled(recentResponses, "start screenshare")) return;
        options.broadcast({ type: "start_screenshare" });
        return;
      }

      // Address detection: the agent only acts when "alfred" is spoken.
      if (!normalized.includes("alfred")) return;
      // Only act on a COMPLETE utterance, never partial/interim transcripts.
      if (!isFinalTranscript(payload)) return;

      const question = stripWakeWord(text);

      // No agent wired, or only the wake word was spoken -> greet.
      if (!options.agent || !question) {
        if (wasRecentlyHandled(recentResponses, "greeting")) return;
        options.broadcast({ type: "say", text: "Hello. I'm Alfred and I'm ready to help!" });
        return;
      }

      if (agentBusy) {
        console.log("[ctl] agent busy; ignoring overlapping request");
        return;
      }
      if (wasRecentlyHandled(recentResponses, `agent:${question}`)) return;

      agentBusy = true;
      console.log(`[ctl] -> agent: ${question}`);
      let answer = "";
      options.agent.ask(question, speaker, {
        onDelta: delta => {
          answer += delta;
        },
        onDone: () => {
          agentBusy = false;
          const finalText = answer.trim();
          console.log("[ctl] <- agent done");
          // Speak the whole answer as ONE TTS utterance. Emitting per-sentence "say"s made
          // consecutive TTS streams overlap in playback ("double voice").
          if (finalText) options.broadcast({ type: "say", text: finalText });
        },
        onError: message => {
          agentBusy = false;
          console.error(`[ctl] agent error: ${message}`);
          options.broadcast({ type: "status", message: `agent error: ${message}` });
        },
        onTrace: (node, event, detail) =>
          console.log(`[ctl] agent trace ${node}:${event}${detail ? ` — ${detail}` : ""}`),
      });
    },
  };
}

/** True for a complete utterance (Recall transcript.data / Deepgram speech_final|is_final). */
function isFinalTranscript(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const obj = payload as Record<string, unknown>;
  const event = typeof obj.event === "string" ? obj.event : "";
  if (event === "transcript.partial_data") return false;
  if (event === "transcript.data") return true;
  if (typeof obj.speech_final === "boolean") return obj.speech_final;
  if (typeof obj.is_final === "boolean") return obj.is_final;
  return true;
}

/** Remove a leading "hey/hello alfred" (or a stray "alfred") so we send the real question. */
function stripWakeWord(text: string): string {
  let out = text.replace(/^\s*(hey|hi|hello|ok|okay)?[\s,]*alfred[\s,.:!?-]*/i, "");
  if (out === text) out = text.replace(/\balfred\b[\s,.:!?-]*/i, " ");
  return out.replace(/\s+/g, " ").trim();
}

export function extractTranscriptText(payload: unknown): string | undefined {
  if (!isTranscriptEvent(payload)) return undefined;

  const deepgramText = extractDeepgramTranscript(payload);
  if (deepgramText) return deepgramText;

  const words = findWords(payload);
  if (words.length > 0) {
    return words.join(" ").replace(/\s+/g, " ").trim();
  }

  const directText = findStringByKey(payload, new Set(["text", "sentence", "transcript"]));
  if (directText) return directText;

  return undefined;
}

function isTranscriptEvent(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const event = "event" in payload ? String(payload.event) : "";
  if (event.startsWith("transcript.")) return true;
  if ("channel" in payload) return true;
  return hasKey(payload, "transcript") || hasKey(payload, "words");
}

function extractDeepgramTranscript(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (!("channel" in payload) || !payload.channel || typeof payload.channel !== "object") {
    return undefined;
  }

  const channel = payload.channel;
  if (!("alternatives" in channel) || !Array.isArray(channel.alternatives)) {
    return undefined;
  }

  const transcript = channel.alternatives
    .map(alternative => {
      if (
        alternative &&
        typeof alternative === "object" &&
        "transcript" in alternative &&
        typeof alternative.transcript === "string"
      ) {
        return alternative.transcript;
      }
      return "";
    })
    .find(text => text.trim());

  return transcript?.trim();
}

function findStringByKey(payload: unknown, keys: Set<string>): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findStringByKey(item, keys);
      if (found) return found;
    }
    return undefined;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (keys.has(key) && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(payload)) {
    const found = findStringByKey(value, keys);
    if (found) return found;
  }

  return undefined;
}

function findWords(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) {
    return payload.flatMap(item => findWords(item));
  }

  const wordsValue = "words" in payload ? payload.words : undefined;
  if (Array.isArray(wordsValue)) {
    const words = wordsValue
      .map(word => {
        if (typeof word === "string") return word;
        if (word && typeof word === "object" && "text" in word) {
          return String(word.text);
        }
        return "";
      })
      .filter(Boolean);
    if (words.length > 0) return words;
  }

  return Object.values(payload).flatMap(value => findWords(value));
}

function hasKey(payload: unknown, key: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload)) return payload.some(item => hasKey(item, key));
  if (key in payload) return true;
  return Object.values(payload).some(value => hasKey(value, key));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStartScreenshareCommand(normalizedText: string): boolean {
  return (
    normalizedText.includes("start screenshare") ||
    normalizedText.includes("start screen share")
  );
}

function wasRecentlyHandled(recentResponses: Map<string, number>, phrase: string): boolean {
  const now = Date.now();
  for (const [key, timestamp] of recentResponses) {
    if (now - timestamp > 5_000) {
      recentResponses.delete(key);
    }
  }

  const lastHandledAt = recentResponses.get(phrase);
  if (lastHandledAt && now - lastHandledAt < 5_000) {
    return true;
  }

  recentResponses.set(phrase, now);
  return false;
}
