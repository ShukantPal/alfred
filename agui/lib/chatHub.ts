import type { ChatMessage, ChatRole, ChatKind, ChatStatus } from "@/lib/chat";

// In-process chat buffer for the screenshare "chat mode". ctl POSTs question/answer
// events here as the delegate path runs; the screenshare ChatWatcher polls (and
// receives /ws/notes pushes) to render bubbles. Lives in process memory alongside
// the transcript and tasks buffers (transcriptHub.ts / tasksHub.ts).
interface Entry {
  seq: number;
  message: ChatMessage;
}

const entries: Entry[] = [];
let seq = 0;
let idCounter = 0;

function makeId(): string {
  idCounter += 1;
  return `c_${idCounter.toString().padStart(3, "0")}`;
}

interface AddInput {
  id?: string;
  role: ChatRole;
  kind: ChatKind;
  text?: string;
  status?: ChatStatus;
  ts?: number;
}

/** Appends a chat message. Returns the stored message (with a resolved id). */
export function addMessage(input: AddInput): ChatMessage {
  const message: ChatMessage = {
    id: input.id?.trim() || makeId(),
    role: input.role,
    kind: input.kind,
    text: typeof input.text === "string" ? input.text.trim() : undefined,
    status: input.kind === "voice" ? (input.status ?? "speaking") : input.status,
    ts: typeof input.ts === "number" && Number.isFinite(input.ts) ? input.ts : Date.now(),
  };
  seq += 1;
  entries.push({ seq, message });
  return message;
}

interface UpdateInput {
  text?: string;
  status?: ChatStatus;
}

/**
 * Patches an existing message by id (e.g. settle a voice bubble to "done").
 * Bumps the seq so pollers pick up the change. Returns the updated message.
 */
export function updateMessage(id: string, patch: UpdateInput): ChatMessage | undefined {
  const target = id.trim();
  if (!target) return undefined;
  const entry = entries.find(item => item.message.id === target);
  if (!entry) return undefined;
  if (typeof patch.text === "string") entry.message.text = patch.text.trim();
  if (patch.status) entry.message.status = patch.status;
  seq += 1;
  entry.seq = seq;
  return entry.message;
}

/** Messages whose seq is newer than the cursor (live catch-up). */
export function messagesSince(after: number): { seq: number; messages: ChatMessage[] } {
  const fresh = entries.filter(entry => entry.seq > after);
  return { seq, messages: fresh.map(entry => entry.message) };
}

/** The full ordered message list. */
export function allMessages(): { seq: number; messages: ChatMessage[] } {
  return { seq, messages: entries.map(entry => entry.message) };
}
