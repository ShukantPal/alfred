export interface TranscriptCommand {
  type: "status" | "say" | "start_screenshare";
  message?: string;
  text?: string;
}

interface TranscriptResponderOptions {
  broadcast(command: TranscriptCommand): void;
}

export function createTranscriptResponder(options: TranscriptResponderOptions) {
  const recentResponses = new Map<string, number>();

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

      if (normalized.includes("hello alfred")) {
        if (wasRecentlyHandled(recentResponses, "hello alfred")) return;

        options.broadcast({
          type: "say",
          text: "Hello. I'm Alfred and I'm ready to help!",
        });
      }
    },
  };
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
